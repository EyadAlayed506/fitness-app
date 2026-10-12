"""The fitness assistant: a chat with an AI that can look at, and add to, the user's own data through tools.

Each tool calls the same code as the app's API (so answers match what the screens show) and only ever
touches the logged-in user's data. Reading tools look things up; logging tools add food, workout sets,
a weigh-in or a night of sleep when the user asks, and report each change as an "action" the app shows
with a link to the right screen and an Undo. The model is told to say when data is missing instead of
guessing, and not to give medical advice.

Two backends answer the same way, with the same tools and rules:
- ClaudeBackend: Claude through Anthropic's API (needs ANTHROPIC_API_KEY; every question costs money).
- OllamaBackend: a free model running on the user's own PC through Ollama (weaker answers, data stays local).
"""

import asyncio
import datetime as dt
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlmodel import Session

from app.models.user import Profile, User
from app.services.activity import (
    completed_workouts,
    local_today,
    sleep_goal,
    user_routine,
)
from app.services.plan import build_plan

MAX_TOOL_ROUNDS = 8  # model calls per question, so a confused loop can't run up the bill
MAX_TOOL_RESULT_CHARS = 20_000
MAX_TOKENS = 16_000
HISTORY_MESSAGES = 20  # earlier messages sent with each question (10 questions and answers)

DISCLAIMER = (
    "The coach is an AI. It reads your data and can log things for you, but it can make mistakes (check what it "
    "added, and use Undo), and it isn't a doctor: for pain, injury or health worries, talk to a professional."
)

# Stable text only (no dates or user data), so it can be cached between requests.
SYSTEM_PROMPT = """You are the coach inside a fitness app. You help one person with their training, sleep and food, using the data they have logged in the app.

How to work:
- Before answering anything about the user's own data, look it up with the tools. Quote the numbers and dates you used. If something isn't logged, say so plainly and suggest how to log it in the app; never invent values or fill gaps with guesses.
- The app's own plan and rules come first: their training days and session types, the recommended calories, the sleep goal. Explain them and help the user follow them; if they want to change the plan, tell them where (Workouts > Edit plan, Profile, Sleep > Change goal). You can't change the plan or settings yourself.
- You can log things for the user: food (log_food), workout sets (log_workout_sets), a weigh-in (log_weight) and a night of sleep (log_sleep), and remove a food entry (remove_food_entry). When the user asks you to add or log something, do it straight away with the right tool, without asking first. If they don't say how much, use one normal serving and say so. Log only what they asked for. Afterwards say exactly what was added (name, amount, meal or day); the app shows it with an Undo button.
- General fitness knowledge is fine (technique, how progressive overload works, protein needs, sleep habits). Keep it practical and mainstream.
- Rest days are part of training. Don't push extra sessions to make up missed ones, very low calories, or training through pain.
- You are not a doctor. Don't diagnose, and don't advise on medication, injuries, eating disorders or medical conditions; for pain, injury, chest pain, dizziness, or anything that worries them, tell them to see a professional. In an emergency, tell them to contact emergency services.
- Don't say that sleep caused a change in performance (or the other way round) just because the numbers moved together.
- Use the user's units (metric or imperial, from their profile). Be brief and friendly: short paragraphs or a few bullet points, plain language.
- The app shows your reply as plain text: no Markdown (no **bold**, headings or tables). Start list items with "• "."""


@dataclass
class Action:
    """Something the assistant changed, shown under its answer with a link and an Undo."""

    kind: str  # "food" | "sets" | "weight" | "sleep" | "removed"
    summary: str  # e.g. "Banana, 1 serving (105 kcal) for breakfast"
    screen: str  # app route to see it, e.g. "/food"
    undo: list[str] = field(default_factory=list)  # API paths to DELETE to undo it


@dataclass
class ToolContext:
    session: Session
    user: User
    profile: Profile
    tz_offset: int | None
    actions: list[Action] = field(default_factory=list)  # filled by the logging tools

    @property
    def today(self) -> dt.date:
        return local_today(self.tz_offset)

    @property
    def now(self) -> dt.datetime:
        """The user's local clock time (no time zone)."""
        utc = dt.datetime.now(dt.UTC)
        if self.tz_offset is None:
            return utc.astimezone().replace(tzinfo=None)
        return (utc + dt.timedelta(minutes=self.tz_offset)).replace(tzinfo=None)


@dataclass
class Tool:
    name: str
    description: str
    properties: dict[str, Any]
    run: Callable[[ToolContext, dict], Any]
    required: list[str] = field(default_factory=list)

    def schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {"type": "object", "properties": self.properties, "required": self.required},
        }


class ToolError(Exception):
    """A problem the model should see and can recover from (bad input, nothing found)."""


def _int(value: Any, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _date(value: Any, ctx: ToolContext) -> dt.date:
    if not value:
        return ctx.today
    try:
        return dt.date.fromisoformat(str(value))
    except ValueError:
        raise ToolError(f"'{value}' isn't a date. Use YYYY-MM-DD.")


# ---------- tools (read-only, current user only) ----------


def _profile(ctx: ToolContext, _: dict) -> Any:
    from app.routers.me import profile_public

    goal = sleep_goal(ctx.profile)
    return {
        "today": ctx.today,
        "weekday": ctx.today.strftime("%A"),
        "profile": profile_public(ctx.profile),
        "plan": build_plan(ctx.profile),
        "sleep_goal_minutes": goal.minutes,
        "sleep_goal_is_custom": goal.custom,
        "recommended_sleep_hours": goal.recommended_hours,
    }


def _training_plan(ctx: ToolContext, _: dict) -> Any:
    return user_routine(ctx.session, ctx.profile)


def _today(ctx: ToolContext, _: dict) -> Any:
    from app.routers.me import read_recommendations

    return read_recommendations(ctx.user, ctx.profile, ctx.session, ctx.tz_offset)


def _workouts(ctx: ToolContext, args: dict) -> Any:
    days = _int(args.get("days"), 14, 1, 90)
    start = ctx.today - dt.timedelta(days=days - 1)
    out = []
    for w in completed_workouts(ctx.session, ctx.user.id, start, ctx.today, ctx.tz_offset):
        by_exercise: dict[str, list[str]] = {}
        for s, ex in w.sets:
            text = f"{s.reps} reps x {s.weight_kg:g} kg" if s.weight_kg else f"{s.reps} reps"
            by_exercise.setdefault(ex.name, []).append(text + (f" (RPE {s.rpe:g})" if s.rpe else ""))
        out.append({"date": w.day, "weekday": w.day.strftime("%A"), "exercises": by_exercise})
    return {"from": start, "to": ctx.today, "finished_workouts": out, "note": "Weights are in kg."}


def _find_exercise(ctx: ToolContext, name: str):
    from app.routers.exercises import search_exercises

    found = search_exercises(ctx.user, ctx.session, search=name, muscle_group=None, limit=1)
    if not found:
        raise ToolError(f"No exercise in the app's library matches '{name}'.")
    return found[0]


def _exercise_history(ctx: ToolContext, args: dict) -> Any:
    from app.routers.analytics import exercise_progress

    exercise = _find_exercise(ctx, str(args.get("exercise", "")))
    data = exercise_progress(exercise.id, ctx.user, ctx.session)
    data["note"] = "Per workout date (UTC): best estimated 1-rep max (Epley) and heaviest set, in kg."
    return data


def _exercise_info(ctx: ToolContext, args: dict) -> Any:
    from app.routers.exercises import exercise_alternatives

    exercise = _find_exercise(ctx, str(args.get("exercise", "")))
    return exercise_alternatives(exercise.id, ctx.user, ctx.session, bool(args.get("all_equipment", False)))


def _sleep(ctx: ToolContext, args: dict) -> Any:
    from app.routers.analytics import sleep_series

    return sleep_series(ctx.user, ctx.session, _int(args.get("days"), 14, 1, 90), ctx.tz_offset)


def _food_day(ctx: ToolContext, args: dict) -> Any:
    from app.routers.foods import food_day

    return food_day(ctx.user, ctx.session, _date(args.get("date"), ctx))


def _calories(ctx: ToolContext, args: dict) -> Any:
    from app.routers.analytics import calorie_series

    days = _int(args.get("days"), 14, 1, 90)
    return calorie_series(ctx.user, ctx.session, ctx.today - dt.timedelta(days=days - 1), ctx.today)


def _weekly_summary(ctx: ToolContext, args: dict) -> Any:
    from app.routers.analytics import read_weekly_summary

    weeks_ago = _int(args.get("weeks_ago"), 0, 0, 52)
    return read_weekly_summary(
        ctx.user, ctx.profile, ctx.session, ctx.tz_offset, ctx.today - dt.timedelta(weeks=weeks_ago)
    )


def _points(ctx: ToolContext, _: dict) -> Any:
    from app.routers.points import read_points

    return read_points(ctx.user, ctx.profile, ctx.session, ctx.tz_offset)


# ---------- logging tools (write, current user only) ----------


def _meal_for(ctx: ToolContext, meal: Any) -> str:
    from app.models.food import Meal

    if meal in {m.value for m in Meal}:
        return str(meal)
    hour = ctx.now.hour  # not given: go by the time of day
    return "breakfast" if hour < 11 else "lunch" if hour < 16 else "dinner" if hour < 22 else "snack"


def _search_online(query: str) -> list:
    """USDA and Open Food Facts results for a food that isn't in the local database (best first)."""
    from app.services import food_search

    async def run():
        async with httpx.AsyncClient(timeout=8) as client:
            found = await asyncio.gather(
                food_search.search_usda(client, query, 3), food_search.search_off(client, query, 3),
                return_exceptions=True,
            )
        return [c for res in found if not isinstance(res, Exception) for c in res]

    return asyncio.run(run())


def _find_food(ctx: ToolContext, name: str):
    """The best match for a food name: the user's foods and the built-in list first, then online."""
    from sqlmodel import or_, select

    from app.models.food import Food
    from app.routers.foods import import_food
    from app.services.food_search import search_local

    foods = list(ctx.session.exec(select(Food).where(or_(Food.owner_id.is_(None), Food.owner_id == ctx.user.id))).all())
    local = search_local(foods, name, limit=1)
    if local:
        return local[0]
    online = _search_online(name)
    if not online:
        raise ToolError(f"Couldn't find '{name}' in the food database or online. Ask the user to add it in the Food tab.")
    return import_food(online[0], ctx.user, ctx.session)


def _log_food(ctx: ToolContext, args: dict) -> Any:
    from app.models.food import FoodAddedVia, FoodLogIn
    from app.routers.foods import log_food
    from app.services.units import SERVING, units_for

    name = str(args.get("food", "")).strip()
    if not name:
        raise ToolError("Say which food to log.")
    food = _find_food(ctx, name)
    allowed = units_for(food.is_liquid, bool(food.serving_size))
    unit = str(args.get("unit") or "").strip().lower()
    try:
        quantity = float(args.get("quantity") or 1)
    except (TypeError, ValueError):
        quantity = 1.0
    if unit not in allowed:  # "piece", "medium", "a", nothing...: one serving if the food has one
        if SERVING not in allowed:
            raise ToolError(f"{food.name} can be logged in: {', '.join(allowed)}. Pick one of those units.")
        unit = SERVING
    if not 0 < quantity <= 5000:
        raise ToolError("The amount must be more than 0.")
    entry = log_food(
        FoodLogIn(food_id=food.id, date=_date(args.get("date"), ctx), meal=_meal_for(ctx, args.get("meal")),
                  quantity=quantity, unit=unit, added_via=FoodAddedVia.search),
        ctx.user, ctx.session,
    )
    amount = f"{quantity:g} {unit}{'s' if unit == SERVING and quantity != 1 else ''}"
    when = "" if entry.date == ctx.today else f" on {entry.date.strftime('%a %d %b')}"
    ctx.actions.append(Action(
        "food", f"{food.name}, {amount} ({round(entry.calories)} kcal) for {entry.meal}{when}", "/food",
        [f"/food-logs/{entry.id}"],
    ))
    return {"logged": entry, "food": food.name, "serving_size": food.serving_size, "serving_unit": food.serving_unit}


def _remove_food(ctx: ToolContext, args: dict) -> Any:
    from app.models.food import FoodLog
    from app.routers.foods import delete_food_log

    entry_id = _int(args.get("entry_id"), 0, 0, 2**31)
    entry = ctx.session.get(FoodLog, entry_id)
    if entry is None or entry.user_id != ctx.user.id:
        raise ToolError("No food entry with that id. Look it up with get_food_day first.")
    calories, meal, day = entry.calories, entry.meal, entry.date
    delete_food_log(entry_id, ctx.user, ctx.session)
    ctx.actions.append(Action("removed", f"Removed a {meal} entry ({round(calories)} kcal) on {day.strftime('%a %d %b')}", "/food"))
    return {"removed": entry_id}


def _log_sets(ctx: ToolContext, args: dict) -> Any:
    from sqlmodel import select

    from app.models.user import WeightUnit
    from app.models.workout import WorkoutSession, WorkoutSessionIn, WorkoutSetIn
    from app.routers.workouts import add_set, start_workout

    exercise = _find_exercise(ctx, str(args.get("exercise", "")))
    sets = _int(args.get("sets"), 1, 1, 10)
    reps = _int(args.get("reps"), 0, 0, 1000)
    if reps <= 0:
        raise ToolError("Say how many reps.")
    try:
        weight = max(0.0, float(args.get("weight") or 0))
    except (TypeError, ValueError):
        weight = 0.0
    unit = "lb" if str(args.get("unit", "")).lower() in ("lb", "lbs", "pounds") else (
        "kg" if args.get("unit") else ("lb" if ctx.profile.unit_system == "imperial" else "kg"))
    workout = ctx.session.exec(
        select(WorkoutSession).where(WorkoutSession.user_id == ctx.user.id, WorkoutSession.ended_at.is_(None))
        .order_by(WorkoutSession.started_at.desc())
    ).first()
    started = workout is None
    workout_id = workout.id if workout else start_workout(WorkoutSessionIn(), ctx.user, ctx.session).id
    added = [
        add_set(workout_id, WorkoutSetIn(exercise_id=exercise.id, reps=reps, weight=weight, unit=WeightUnit(unit)),
                ctx.user, ctx.session)
        for _ in range(sets)
    ]
    load = f" x {weight:g} {unit}" if weight else ""
    ctx.actions.append(Action(
        "sets", f"{exercise.name}: {sets} set{'s' if sets > 1 else ''} of {reps}{load}"
        + (" (started a workout)" if started else ""), "/workouts",
        [f"/workouts/{workout_id}/sets/{s.id}" for s in added],
    ))
    return {"workout_id": workout_id, "started_new_workout": started, "sets": added}


def _log_weight(ctx: ToolContext, args: dict) -> Any:
    from app.models.user import WeightEntryIn, WeightUnit
    from app.routers.me import log_weight

    try:
        value = float(args.get("weight"))
    except (TypeError, ValueError):
        raise ToolError("Say the weight as a number.")
    unit = WeightUnit("lb" if str(args.get("unit", "")).lower() in ("lb", "lbs", "pounds") else "kg")
    if args.get("unit") is None and ctx.profile.unit_system == "imperial":
        unit = WeightUnit("lb")
    entry = log_weight(WeightEntryIn(date=_date(args.get("date"), ctx), weight=value, unit=unit), ctx.profile, ctx.session)
    ctx.actions.append(Action("weight", f"Weigh-in: {value:g} {unit.value} on {entry.date.strftime('%a %d %b')}", "/home",
                              [f"/me/weight/{entry.id}"]))
    return entry


def _log_sleep(ctx: ToolContext, args: dict) -> Any:
    from app.models.sleep import SleepEntryIn
    from app.routers.sleep import log_sleep

    try:
        data = SleepEntryIn(bedtime=args.get("bedtime"), wake_time=args.get("wake_time"), quality=args.get("quality"))
    except ValueError as e:
        raise ToolError(f"Bad sleep times: {e}. Use YYYY-MM-DDTHH:MM for bedtime and wake_time.")
    entry = log_sleep(data, ctx.user, ctx.session)
    h, m = divmod(entry.duration_minutes, 60)
    ctx.actions.append(Action(
        "sleep", f"Sleep {data.bedtime:%H:%M}-{data.wake_time:%H:%M} ({h} h {m:02d} min), night to {entry.date:%a %d %b}",
        "/sleep", [f"/sleep/{entry.id}"],
    ))
    return entry


_DAYS = {"type": "integer", "description": "How many days back from today (1-90)."}
_EXERCISE = {"type": "string", "description": "Exercise or machine name, e.g. 'leg press'."}

TOOLS = [
    Tool("get_profile_and_plan",
         "Today's date, the user's profile (age, sex, height, weight, goal, diet, units, equipment, training days), "
         "their calorie plan (BMI, maintenance and target calories, diet options) and sleep goal.",
         {}, _profile),
    Tool("get_training_plan",
         "The user's weekly training plan: training days, the session type and name for each day, the exercises "
         "with sets, reps and rest, why this split was recommended, and notes about the plan.",
         {}, _training_plan),
    Tool("get_today_suggestions",
         "The app's rule-based suggestions for today (planned session or rest day, short sleep, WHOOP recovery, "
         "missed sessions, progression), each with its reasons.",
         {}, _today),
    Tool("get_recent_workouts",
         "Finished workouts with every set (reps, weight, RPE), grouped by exercise.",
         {"days": _DAYS}, _workouts),
    Tool("get_exercise_history",
         "Progress over time for one exercise the user has logged: best estimated 1RM, heaviest set and volume per workout.",
         {"exercise": _EXERCISE}, _exercise_history, required=["exercise"]),
    Tool("get_exercise_info",
         "How to do an exercise from the app's library (instructions, muscles, default rest) and alternatives "
         "(similar = same movement; different = same muscles, not a like-for-like swap), filtered to the user's "
         "equipment unless all_equipment is true.",
         {"exercise": _EXERCISE, "all_equipment": {"type": "boolean"}}, _exercise_info, required=["exercise"]),
    Tool("get_sleep",
         "Sleep per night (hours, bed and wake times, WHOOP or manual, stages and recovery when a tracker measured "
         "them; null = not logged), the sleep goal, 7-day average vs the 7 days before, and bedtime consistency.",
         {"days": _DAYS}, _sleep),
    Tool("get_food_day",
         "Everything the user logged to eat on one day, with calories and macros per item and the day's totals "
         "against their target.",
         {"date": {"type": "string", "description": "YYYY-MM-DD; default today."}}, _food_day),
    Tool("get_calorie_trend",
         "Daily calories and macros for recent days against the calorie target (0 = nothing logged that day).",
         {"days": _DAYS}, _calories),
    Tool("get_weekly_summary",
         "A Monday-Sunday week: sessions done vs planned, lifts vs last time, records, sleep, weight goal, points, "
         "compared with the week before.",
         {"weeks_ago": {"type": "integer", "description": "0 = this week, 1 = last week, ..."}}, _weekly_summary),
    Tool("get_points",
         "Wellness points: total, level, today's points with reasons, achievements, and how points are earned.",
         {}, _points),
    Tool("log_food",
         "Add a food to the user's food log right away. Finds the food by name (their foods, the built-in list, then "
         "online databases). Units: 'serving' (one normal portion, e.g. one banana), or g/kg/oz/lb for solids, "
         "ml/l/cup/fl_oz for drinks.",
         {"food": {"type": "string", "description": "e.g. 'banana', 'greek yogurt'"},
          "quantity": {"type": "number", "description": "How many units; default 1."},
          "unit": {"type": "string", "description": "serving, g, kg, oz, lb, ml, l, cup...; default serving."},
          "meal": {"type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"]},
          "date": {"type": "string", "description": "YYYY-MM-DD; default today."}},
         _log_food, required=["food"]),
    Tool("remove_food_entry",
         "Remove one entry from the food log, by its id from get_food_day. Only when the user asks.",
         {"entry_id": {"type": "integer"}}, _remove_food, required=["entry_id"]),
    Tool("log_workout_sets",
         "Add sets of an exercise to the workout in progress (starts one if none is open).",
         {"exercise": _EXERCISE,
          "sets": {"type": "integer", "description": "How many sets with these reps and weight; default 1."},
          "reps": {"type": "integer"},
          "weight": {"type": "number", "description": "0 for bodyweight."},
          "unit": {"type": "string", "enum": ["kg", "lb"]}},
         _log_sets, required=["exercise", "reps"]),
    Tool("log_weight",
         "Record a weigh-in (one per day; a second one the same day replaces the first).",
         {"weight": {"type": "number"}, "unit": {"type": "string", "enum": ["kg", "lb"]},
          "date": {"type": "string", "description": "YYYY-MM-DD; default today."}},
         _log_weight, required=["weight"]),
    Tool("log_sleep",
         "Record a night of sleep by hand. Times are the user's local clock times.",
         {"bedtime": {"type": "string", "description": "YYYY-MM-DDTHH:MM, e.g. 2026-10-11T23:30"},
          "wake_time": {"type": "string", "description": "YYYY-MM-DDTHH:MM, e.g. 2026-10-12T07:00"},
          "quality": {"type": "integer", "description": "1 (very poor) to 5 (great), optional."}},
         _log_sleep, required=["bedtime", "wake_time"]),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}
TOOL_SCHEMAS = [t.schema() for t in TOOLS]


def run_tool(ctx: ToolContext, name: str, args: dict, max_chars: int = MAX_TOOL_RESULT_CHARS) -> tuple[str, bool]:
    """Run a tool and return (JSON text, is_error)."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return f"There is no tool called {name}.", True
    try:
        data = tool.run(ctx, args if isinstance(args, dict) else {})
    except ToolError as e:
        return str(e), True
    except HTTPException as e:  # e.g. "Exercise not found" or an overlapping sleep, from the API code
        return str(e.detail), True
    except ValueError as e:  # invalid values the API models refuse
        return f"Invalid input: {e}", True
    text = json.dumps(jsonable_encoder(data), separators=(",", ":"), ensure_ascii=False)
    if len(text) > max_chars:
        text = text[:max_chars] + " ... [cut short: ask for fewer days]"
    return text, False


# ---------- the conversation ----------


@dataclass
class Answer:
    text: str
    tools_used: list[str]


class AssistantError(Exception):
    """The AI service couldn't answer; `detail` says why in words the user can act on."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _context_note(ctx: ToolContext) -> str:
    units = "imperial (lb, in)" if ctx.profile.unit_system == "imperial" else "metric (kg, cm)"
    return f"(App note: today is {ctx.today.strftime('%A')} {ctx.today.isoformat()} for the user; their units are {units}.)"


CUT_OFF = "\n\n(My answer got cut off. Ask me to continue or to keep it shorter.)"
TOO_MANY_STEPS = "Sorry, that took too many steps. Could you ask in a simpler way?"
NO_ANSWER = "Sorry, I don't have an answer for that."


class ClaudeBackend:
    """Claude through Anthropic's API: the strongest answers; costs money per question."""

    provider = "claude"
    metered = True  # questions count toward ASSISTANT_DAILY_LIMIT

    def __init__(self, client: Any, model: str):
        self.client = client  # None when there is no API key
        self.model = model

    def problem(self) -> str | None:
        if self.client is None:
            return (
                "The assistant isn't set up on this server yet. For Claude: get an API key at console.anthropic.com, "
                "put it in the backend's .env file as ANTHROPIC_API_KEY and restart the backend."
            )
        return None

    def ask(self, ctx: ToolContext, history: list[tuple[str, str]], question: str) -> Answer:
        import anthropic

        try:
            return self._ask(ctx, history, question)
        except anthropic.AuthenticationError:
            raise AssistantError(502, "The Anthropic API key was refused. Check ANTHROPIC_API_KEY in .env.")
        except anthropic.RateLimitError:
            raise AssistantError(429, "The assistant is busy right now. Try again in a minute.")
        except anthropic.APIStatusError as e:
            raise AssistantError(502, f"The assistant couldn't answer ({e.status_code}): {e.message}")
        except anthropic.APIConnectionError:
            raise AssistantError(502, "Couldn't reach the assistant service. Check the internet connection.")

    def _ask(self, ctx: ToolContext, history: list[tuple[str, str]], question: str) -> Answer:
        """Calls Claude with tools until it gives a final answer (at most MAX_TOOL_ROUNDS model calls)."""
        messages: list[dict] = [{"role": role, "content": text} for role, text in history[-HISTORY_MESSAGES:]]
        messages.append({"role": "user", "content": [
            {"type": "text", "text": question},
            {"type": "text", "text": _context_note(ctx)},
        ]})
        used: list[str] = []
        for _ in range(MAX_TOOL_ROUNDS):
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=MAX_TOKENS,
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=TOOL_SCHEMAS,
                messages=messages,
                output_config={"effort": "medium"},
                cache_control={"type": "ephemeral"},  # also cache the growing conversation within this question
                # if Claude declines for safety reasons, the API retries on another model in the same call
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
            if response.stop_reason == "refusal":
                return Answer("Sorry, I can't help with that one. For health worries, please talk to a professional.", used)
            if response.stop_reason in ("tool_use", "pause_turn"):
                # keep the whole reply (including any thinking blocks) unchanged, then add the tool results
                messages.append({"role": "assistant", "content": response.content})
                results = []
                for block in response.content:
                    if block.type == "tool_use":
                        used.append(block.name)
                        text, is_error = run_tool(ctx, block.name, block.input)
                        results.append({"type": "tool_result", "tool_use_id": block.id, "content": text, "is_error": is_error})
                if results:
                    messages.append({"role": "user", "content": results})
                continue
            text = "\n\n".join(b.text for b in response.content if b.type == "text").strip()
            if response.stop_reason == "max_tokens":
                text += CUT_OFF
            return Answer(text or NO_ANSWER, used)
        return Answer(TOO_MANY_STEPS, used)


# Small local models have less room: shorter history and tool results
OLLAMA_HISTORY_MESSAGES = 10
OLLAMA_TOOL_RESULT_CHARS = 8_000
OLLAMA_TOOLS = [{"type": "function", "function": {
    "name": t["name"], "description": t["description"], "parameters": t["input_schema"],
}} for t in TOOL_SCHEMAS]
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


class OllamaBackend:
    """A model running on this PC through Ollama (https://ollama.com): free and private, weaker than Claude."""

    provider = "ollama"
    metered = False  # free: no daily limit

    def __init__(self, http: httpx.Client, url: str, model: str, num_ctx: int):
        self.http = http
        self.url = url.rstrip("/")
        self.model = model
        self.num_ctx = num_ctx

    def problem(self) -> str | None:
        try:
            r = self.http.get(f"{self.url}/api/tags", timeout=3)
            r.raise_for_status()
            names = {m.get("name") for m in r.json().get("models", [])}
        except (httpx.HTTPError, ValueError):
            return (
                f"Ollama isn't running on this PC (nothing answered at {self.url}). Start the Ollama app, "
                "or install it from ollama.com, then try again."
            )
        if self.model not in names and f"{self.model}:latest" not in names:
            return f"The model {self.model} isn't downloaded yet. Open a terminal and run: ollama pull {self.model}"
        return None

    def ask(self, ctx: ToolContext, history: list[tuple[str, str]], question: str) -> Answer:
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages += [{"role": role, "content": text} for role, text in history[-OLLAMA_HISTORY_MESSAGES:]]
        messages.append({"role": "user", "content": f"{question}\n\n{_context_note(ctx)}"})
        used: list[str] = []
        for _ in range(MAX_TOOL_ROUNDS):
            reply = self._chat(messages)
            message = reply.get("message") or {}
            calls = message.get("tool_calls") or []
            if calls:
                messages.append({"role": "assistant", "content": message.get("content", ""), "tool_calls": calls})
                for call in calls:
                    fn = call.get("function") or {}
                    name, args = fn.get("name", ""), fn.get("arguments") or {}
                    if isinstance(args, str):  # some models send the arguments as a JSON string
                        try:
                            args = json.loads(args)
                        except ValueError:
                            args = {}
                    used.append(name)
                    text, is_error = run_tool(ctx, name, args, OLLAMA_TOOL_RESULT_CHARS)
                    messages.append({"role": "tool", "tool_name": name, "content": f"Error: {text}" if is_error else text})
                continue
            text = _THINK.sub("", message.get("content") or "").strip()
            if reply.get("done_reason") == "length":
                text += CUT_OFF
            return Answer(text or NO_ANSWER, used)
        return Answer(TOO_MANY_STEPS, used)

    def _chat(self, messages: list[dict]) -> dict:
        try:
            r = self.http.post(
                f"{self.url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "tools": OLLAMA_TOOLS,
                    "stream": False,
                    "options": {"num_ctx": self.num_ctx},  # room for the tools, the history and the data
                },
                timeout=300,  # a local model can take a while, especially the first time it loads
            )
        except httpx.TimeoutException:
            raise AssistantError(504, "The local AI took too long to answer. Try a shorter question or a smaller model.")
        except httpx.HTTPError:
            raise AssistantError(502, f"Couldn't reach Ollama at {self.url}. Is the Ollama app running?")
        if r.status_code == 404:
            raise AssistantError(502, f"The model {self.model} isn't downloaded. Run: ollama pull {self.model}")
        if r.status_code >= 400:
            try:
                detail = r.json().get("error", r.text)
            except ValueError:
                detail = r.text
            raise AssistantError(502, f"The local AI couldn't answer: {detail}")
        return r.json()
