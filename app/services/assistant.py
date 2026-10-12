"""The fitness assistant: a chat with an AI that can look at the user's own data through read-only tools.

Each tool calls the same code as the app's API (so answers match what the screens show) and only ever
reads the logged-in user's data. Nothing is written except the conversation itself. The model is told
to say when data is missing instead of guessing, and not to give medical advice.

Two backends answer the same way, with the same tools and rules:
- ClaudeBackend: Claude through Anthropic's API (needs ANTHROPIC_API_KEY; every question costs money).
- OllamaBackend: a free model running on the user's own PC through Ollama (weaker answers, data stays local).
"""

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


def run_tool(ctx: ToolContext, name: str, args: dict, max_chars: int = MAX_TOOL_RESULT_CHARS) -> tuple[str, bool]:
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
