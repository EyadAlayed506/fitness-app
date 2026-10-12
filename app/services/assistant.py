"""The fitness assistant: a chat with Claude that can look at the user's own data through read-only tools.

Each tool calls the same code as the app's API (so answers match what the screens show) and only ever
reads the logged-in user's data. Nothing is written except the conversation itself. The model is told
to say when data is missing instead of guessing, and not to give medical advice.

Needs an Anthropic API key (ANTHROPIC_API_KEY in .env). Every message costs money; see the README.
"""

import datetime as dt
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

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
    "The assistant is an AI. It reads your logged data to answer, can make mistakes, and isn't a doctor: "
    "for pain, injury or health worries, talk to a professional."
)

# Stable text only (no dates or user data), so it can be cached between requests.
SYSTEM_PROMPT = """You are the coach inside a fitness app. You help one person with their training, sleep and food, using the data they have logged in the app.

How to work:
- Before answering anything about the user's own data, look it up with the tools. Quote the numbers and dates you used. If something isn't logged, say so plainly and suggest how to log it in the app; never invent values or fill gaps with guesses.
- The app's own plan and rules come first: their training days and session types, the recommended calories, the sleep goal. Explain them and help the user follow them; if they want to change the plan, tell them where (Workouts > Edit plan, Profile, Sleep > Change goal). You can't change anything in the app yourself.
- General fitness knowledge is fine (technique, how progressive overload works, protein needs, sleep habits). Keep it practical and mainstream.
- Rest days are part of training. Don't push extra sessions to make up missed ones, very low calories, or training through pain.
- You are not a doctor. Don't diagnose, and don't advise on medication, injuries, eating disorders or medical conditions; for pain, injury, chest pain, dizziness, or anything that worries them, tell them to see a professional. In an emergency, tell them to contact emergency services.
- Don't say that sleep caused a change in performance (or the other way round) just because the numbers moved together.
- Use the user's units (metric or imperial, from their profile). Be brief and friendly: short paragraphs or a few bullet points, plain language.
- The app shows your reply as plain text: no Markdown (no **bold**, headings or tables). Start list items with "• "."""


@dataclass
class ToolContext:
    session: Session
    user: User
    profile: Profile
    tz_offset: int | None

    @property
    def today(self) -> dt.date:
        return local_today(self.tz_offset)


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
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}
TOOL_SCHEMAS = [t.schema() for t in TOOLS]


def run_tool(ctx: ToolContext, name: str, args: dict) -> tuple[str, bool]:
    """Run a tool and return (JSON text, is_error)."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return f"There is no tool called {name}.", True
    try:
        data = tool.run(ctx, args if isinstance(args, dict) else {})
    except ToolError as e:
        return str(e), True
    except HTTPException as e:  # e.g. "Exercise not found" from the API code
        return str(e.detail), True
    text = json.dumps(jsonable_encoder(data), separators=(",", ":"), ensure_ascii=False)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + " ... [cut short: ask for fewer days]"
    return text, False


# ---------- the conversation ----------


@dataclass
class Answer:
    text: str
    tools_used: list[str]


def _context_note(ctx: ToolContext) -> str:
    units = "imperial (lb, in)" if ctx.profile.unit_system == "imperial" else "metric (kg, cm)"
    return f"(App note: today is {ctx.today.strftime('%A')} {ctx.today.isoformat()} for the user; their units are {units}.)"


def ask(client: Any, model: str, ctx: ToolContext, history: list[tuple[str, str]], question: str) -> Answer:
    """Answer one question. `history` is earlier (role, text) pairs, oldest first. Calls Claude with tools
    until it gives a final answer (at most MAX_TOOL_ROUNDS model calls)."""
    messages: list[dict] = [{"role": role, "content": text} for role, text in history[-HISTORY_MESSAGES:]]
    messages.append({"role": "user", "content": [
        {"type": "text", "text": question},
        {"type": "text", "text": _context_note(ctx)},
    ]})
    used: list[str] = []
    for _ in range(MAX_TOOL_ROUNDS):
        response = client.beta.messages.create(
            model=model,
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
            text += "\n\n(My answer got cut off. Ask me to continue or to keep it shorter.)"
        return Answer(text or "Sorry, I don't have an answer for that.", used)
    return Answer("Sorry, that took too many steps. Could you ask in a simpler way?", used)
