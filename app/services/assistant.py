"""The fitness assistant: a chat with an AI that can look at, and add to, the user's own data through tools.

Each tool calls the same code as the app's API (so answers match what the screens show) and only ever
touches the logged-in user's data. Reading tools look things up; logging tools add food, workout sets,
a weigh-in or a night of sleep when the user asks, and report each change as an "action" the app shows
with a link to the right screen and an Undo. The model is told to say when data is missing instead of
guessing, and not to give medical advice.

Three backends answer the same way, with the same tools and rules:
- ClaudeBackend: Claude through Anthropic's API (needs ANTHROPIC_API_KEY; every question costs money).
- GeminiBackend: Google Gemini's free tier through its OpenAI-compatible API (needs GEMINI_API_KEY; a small
  daily quota shared by every user, and Google may use free-tier data).
- OllamaBackend: a free model running on the user's own PC through Ollama (weaker answers, data stays local).
"""

import asyncio
import datetime as dt
import json
import re
import time
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

from app.i18n import Table, current_language, short_date, tr, tr_count
from app.models.exercise import exercise_label

MAX_TOOL_ROUNDS = 8  # model calls per question, so a confused loop can't run up the bill
MAX_TOOL_RESULT_CHARS = 20_000
MAX_TOKENS = 16_000
HISTORY_MESSAGES = 20  # earlier messages sent with each question (10 questions and answers)

# What the user sees from the coach besides its replies, in the language of the request (app.i18n)
TEXTS: Table = {
    "en": {
        "disclaimer": "The coach is an AI. It reads your data and can log things for you, but it can make mistakes (check what it "
        "added, and use Undo), and it isn't a doctor: for pain, injury or health worries, talk to a professional.",
        "cut_off": "\n\n(My answer got cut off. Ask me to continue or to keep it shorter.)",
        "too_many_steps": "Sorry, that took too many steps. Could you ask in a simpler way?",
        "no_answer": "Sorry, I don't have an answer for that.",
        "refusal": "Sorry, I can't help with that one. For health worries, please talk to a professional.",
        "no_key": "The assistant isn't set up on this server yet. For Claude: get an API key at console.anthropic.com, "
        "put it in the backend's .env file as ANTHROPIC_API_KEY and restart the backend.",
        "key_refused": "The Anthropic API key was refused. Check ANTHROPIC_API_KEY in .env.",
        "busy": "The assistant is busy right now. Try again in a minute.",
        "couldnt_answer": "The assistant couldn't answer ({status}): {message}",
        "unreachable": "Couldn't reach the assistant service. Check the internet connection.",
        "ollama_off": "Ollama isn't running on this PC (nothing answered at {url}). Start the Ollama app, "
        "or install it from ollama.com, then try again.",
        "ollama_no_model": "The model {model} isn't downloaded yet. Open a terminal and run: ollama pull {model}",
        "ollama_slow": "The local AI took too long to answer. Try a shorter question or a smaller model.",
        "ollama_failed": "The local AI couldn't answer: {detail}",
        "gemini_no_key": "The coach isn't set up on this server yet. For Gemini: create a free API key at "
        "aistudio.google.com, put it in the backend's .env file as GEMINI_API_KEY and restart the backend.",
        "gemini_key_refused": "The Gemini API key was refused. Check GEMINI_API_KEY in .env.",
        "gemini_quota": "The coach has used up its free questions for now. Try again in a little while, or tomorrow.",
        "gemini_slow": "The coach took too long to answer. Try again, or ask a shorter question.",
        "gemini_note": "Replies come from Google Gemini (free tier): Google may use the questions and the data sent "
        "with them to improve its products.",
        "partial_failure": "I added: {done}. Then something went wrong: {error}",
        "action_food": "{food}, {amount} ({kcal} kcal{estimate}) for {meal}{when}",
        "ai_estimate": ", AI estimate",
        "on_day": " on {day}",
        "action_removed": "Removed a {meal} entry ({kcal} kcal) on {day}",
        "action_sets": "{exercise}: {sets} of {reps}{load}{started}",
        "set_count": "{n} set|{n} sets",
        "started": " (started a workout)",
        "action_weight": "Weigh-in: {weight} on {day}",
        "action_sleep": "Sleep {bed}-{wake} ({h} h {m} min), night to {day}",
        "serving": "{n} serving|{n} servings",
        "meal.breakfast": "breakfast",
        "meal.lunch": "lunch",
        "meal.dinner": "dinner",
        "meal.snack": "snack",
        "reply_in": "Reply in the language of this latest message of the user's (just above this note), even if earlier messages were in another language: Arabic (simple Modern Standard Arabic) if they wrote in "
        "Arabic, English if they wrote in English. The app is set to English; use English only when the message's "
        "language isn't clear.",
    },
    "ar": {
        "disclaimer": "المدرب ذكاء اصطناعي. يقرأ بياناتك ويستطيع تسجيل الأشياء لك، لكنه قد يخطئ (تحقّق مما أضافه "
        "واستخدم «تراجع»)، وهو ليس طبيباً: في حالة الألم أو الإصابة أو القلق على صحتك، استشر مختصاً.",
        "cut_off": "\n\n(انقطعت إجابتي. اطلب مني المتابعة أو اختصار الإجابة.)",
        "too_many_steps": "عذراً، احتاج ذلك خطوات كثيرة. هل يمكنك السؤال بطريقة أبسط؟",
        "no_answer": "عذراً، ليست لدي إجابة عن ذلك.",
        "refusal": "عذراً، لا أستطيع المساعدة في هذا. إن كان الأمر يتعلق بصحتك، فتحدّث مع مختص.",
        "no_key": "المساعد غير مُعدّ على هذا الخادم بعد. لاستخدام Claude: احصل على مفتاح API من console.anthropic.com، "
        "وضعه في ملف ‎.env في الخادم باسم ANTHROPIC_API_KEY ثم أعد تشغيل الخادم.",
        "key_refused": "رُفض مفتاح Anthropic API. تحقّق من ANTHROPIC_API_KEY في ملف ‎.env.",
        "busy": "المساعد مشغول الآن. حاول مرة أخرى بعد دقيقة.",
        "couldnt_answer": "تعذّر على المساعد الإجابة ({status}): {message}",
        "unreachable": "تعذّر الوصول إلى خدمة المساعد. تحقّق من الاتصال بالإنترنت.",
        "ollama_off": "Ollama لا يعمل على هذا الجهاز (لا استجابة على {url}). شغّل تطبيق Ollama، "
        "أو ثبّته من ollama.com، ثم حاول مجدداً.",
        "ollama_no_model": "النموذج {model} لم يُنزَّل بعد. افتح الطرفية ونفّذ: ollama pull {model}",
        "ollama_slow": "تأخّر الذكاء الاصطناعي المحلي في الإجابة. جرّب سؤالاً أقصر أو نموذجاً أصغر.",
        "ollama_failed": "تعذّر على الذكاء الاصطناعي المحلي الإجابة: {detail}",
        "gemini_no_key": "المدرب غير مُعدّ على هذا الخادم بعد. لاستخدام Gemini: أنشئ مفتاح API مجانياً من "
        "aistudio.google.com، وضعه في ملف ‎.env في الخادم باسم GEMINI_API_KEY ثم أعد تشغيل الخادم.",
        "gemini_key_refused": "رُفض مفتاح Gemini API. تحقّق من GEMINI_API_KEY في ملف ‎.env.",
        "gemini_quota": "استهلك المدرب أسئلته المجانية حالياً. حاول مرة أخرى بعد قليل، أو غداً.",
        "gemini_slow": "تأخّر المدرب في الإجابة. حاول مرة أخرى، أو اسأل سؤالاً أقصر.",
        "gemini_note": "الإجابات من Google Gemini (الفئة المجانية): قد تستخدم Google الأسئلة والبيانات المرسلة معها "
        "لتحسين منتجاتها.",
        "partial_failure": "أضفتُ: {done}. ثم حدث خطأ: {error}",
        "action_food": "{food}، {amount} ({kcal} سعرة{estimate}) في {meal}{when}",
        "ai_estimate": "، تقدير الذكاء الاصطناعي",
        "on_day": " يوم {day}",
        "action_removed": "أُزيل عنصر من {meal} ({kcal} سعرة) يوم {day}",
        "action_sets": "{exercise}: {sets} من {reps} تكرار{load}{started}",
        "set_count": "لا مجموعات|مجموعة واحدة|مجموعتان|{n} مجموعات|{n} مجموعة|{n} مجموعة",
        "started": " (بدأ تمريناً)",
        "action_weight": "الوزن: {weight} يوم {day}",
        "action_sleep": "النوم {bed}-{wake} ({h} س {m} د)، ليلة {day}",
        "serving": "لا حصص|حصة واحدة|حصتان|{n} حصص|{n} حصة|{n} حصة",
        "meal.breakfast": "الفطور",
        "meal.lunch": "الغداء",
        "meal.dinner": "العشاء",
        "meal.snack": "الوجبة الخفيفة",
        "reply_in": "Reply in the language of this latest message of the user's (just above this note), even if earlier messages were in another language: Arabic (simple Modern Standard Arabic) if they wrote in "
        "Arabic, English if they wrote in English. The app is set to Arabic; use Arabic when the message's language "
        "isn't clear. Keep numbers in Western digits (0-9) and units as the app shows them.",
    },
}

# Kept for code and tests that read them directly: the English texts
DISCLAIMER = TEXTS["en"]["disclaimer"]


def disclaimer(provider: str | None = None) -> str:
    """Shown under the message box; with Gemini's free tier it also says where the questions go."""
    text = tr(TEXTS, "disclaimer")
    return f"{text} {tr(TEXTS, 'gemini_note')}" if provider == "gemini" else text


def partial_failure(done: str, error: str) -> str:
    """The reply when the AI failed after a tool had already saved something (kept, with its Undo)."""
    return _plain(tr(TEXTS, "partial_failure", done=done, error=error))


def _meal(meal: str) -> str:
    key = f"meal.{meal}"
    return tr(TEXTS, key) if key in TEXTS["en"] else meal

# Stable text only (no dates or user data), so it can be cached between requests.
SYSTEM_PROMPT = """You are the coach inside a fitness app. You help one person with their training, sleep and food, using the data they have logged in the app.

How to work:
- Before answering anything about the user's own data, look it up with the tools. Quote the numbers and dates you used. If something isn't logged, say so plainly and suggest how to log it in the app; never invent values or fill gaps with guesses.
- Quote the targets, averages, totals and differences the tools give (macro targets, full-day averages, fiber, sugar and sodium, sleep stage averages); don't work out your own. Today isn't over yet: for averages and habits use the full days the tools give, and talk about today separately.
- For a check-up, a review of the week or "how am I doing" in any language, look at all three: food (get_food_summary), sleep (get_sleep) and training (get_recent_workouts or get_weekly_summary), then answer. For questions about the user's eating habits, healthy eating or the foods they eat most, use get_food_summary. For whether one thing goes with another (sleep after training days, sleep and lifts), use get_patterns. For steps, walking or daily activity, use get_steps; in a check-up, add steps when the user has them. Say today's steps are "so far" and as of the last sync.
- The app's own plan and rules come first: their training days and session types, the recommended calories, the sleep goal. Explain them and help the user follow them; if they want to change the plan, tell them where (Workouts > Edit plan, Profile, Sleep > Change goal). You can't change the plan or settings yourself.
- You can log things for the user: food (log_food), workout sets (log_workout_sets), a weigh-in (log_weight) and a night of sleep (log_sleep), and remove a food entry (remove_food_entry). When the user asks you to add or log something, do it straight away with the right tool, without asking first. If they don't say how much, use one normal serving and say so. Log only what they asked for, one log_food call per food.
- Food goes to a meal: breakfast, lunch, dinner or snack. If the user didn't say which meal in their message, don't log it yet: ask which one in one short question, then log it when they answer. Never guess the meal from the time of day or from earlier messages. Afterwards say exactly what was added (name, amount, meal or day); the app shows it with an Undo button.
- If a food isn't in the database, log_food says so: call it again with your best estimate of its nutrition per 100 g (or 100 ml) from your own knowledge. It's saved as one of the user's own foods, marked "AI estimate", and logged; tell them the numbers are your estimate.
- Only say something was added or logged when the tool's result says it was. If a tool returns an error, nothing was saved: say so, and never make up the result.
- General fitness knowledge is fine (technique, how progressive overload works, protein needs, sleep habits). Keep it practical and mainstream.
- Rest days are part of training. Don't push extra sessions to make up missed ones, very low calories, or training through pain.
- You are not a doctor. Don't diagnose, and don't advise on medication, injuries, eating disorders or medical conditions; for pain, injury, chest pain, dizziness, or anything that worries them, tell them to see a professional. In an emergency, tell them to contact emergency services.
- Don't say that sleep caused a change in performance (or the other way round) just because the numbers moved together.
- Weights without a unit: use the user's units, unless the number doesn't fit them or their records (e.g. "I weigh 200" from someone around 95 kg, or "bench 135" when they lift about 60 kg). Then don't log yet: ask in one short question whether it's kg or lb. Don't ask when the unit was said or the number clearly fits.
- Use the user's units (metric or imperial, from their profile). Be brief, warm and encouraging, in plain language.
- Reply in the language the app note names (English or Arabic), unless the user writes in another language. Food and exercise names from the tools can stay as they are.

How your replies look (the app shows them on a phone screen):
- Start with the answer in one short sentence. Then add only the details that help.
- Split longer answers into small blocks with an empty line between them. A block can start with a short title line that begins with one fitting emoji, e.g. "💪 Training", "🍗 Food", "😴 Sleep", "⚖️ Weight", "✅ Logged", "⚠️ Careful".
- Lists: one item per line, starting with "• ". At most 5 items; each fits on one or two lines.
- Make the key numbers bold with **double asterisks**, e.g. "**1,314 kcal** left today". Bold nothing else. No other Markdown: no headings (#), tables, links or italics.
- Emojis: one per block title, and at most one or two more in the whole reply where they add something (🔥 for a new best, 🎉 for a goal reached). Never in a warning about health, pain or injury beyond the ⚠️ title.
- Short replies (a quick answer, a logged food) are one or two lines, with no title.

Example:
You're on track today 👍

🍗 Food
• **1,122 kcal** eaten, **1,314 kcal** left
• Protein **84 g** of **183 g**, so aim for a protein-rich dinner

😴 Sleep
• **7 h 21 min** last night, above your **7 h** goal"""


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
    question: str | None = None  # the user's message being answered (None: a tool run outside a chat)

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
        "macro_targets": macro_targets(build_plan(ctx.profile).target_calories),
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

    result = jsonable_encoder(sleep_series(ctx.user, ctx.session, _int(args.get("days"), 14, 1, 90), ctx.tz_offset))
    result["stage_averages"] = stage_averages(result.get("nights") or [])
    return result


# ---------- numbers worked out here, so the coach quotes them instead of doing sums itself ----------

# The same split as the app's macro bars (mobile/src/components/MacroBars.tsx): share of calories, kcal per gram
MACRO_SPLIT = {"protein_g": (0.30, 4), "carbs_g": (0.40, 4), "fat_g": (0.30, 9)}
MACROS = ("calories", "protein_g", "carbs_g", "fat_g")
OTHER_NUTRIENTS = ("fiber_g", "sugar_g", "added_sugar_g", "saturated_fat_g", "sodium_mg", "potassium_mg", "cholesterol_mg")


def macro_targets(target_kcal: float | None) -> dict | None:
    """The daily targets the app shows: calories from the plan, protein/carbs/fat as 30/40/30% of them."""
    if not target_kcal:
        return None
    out: dict[str, float] = {"calories": round(target_kcal)}
    for key, (share, kcal_per_g) in MACRO_SPLIT.items():
        out[key] = round(target_kcal * share / kcal_per_g)
    return out


def guidelines(target_kcal: float | None) -> dict:
    """General adult guidance for nutrients the app sets no target for (not personal medical advice)."""
    kcal = target_kcal or 2000
    return {
        "fiber_g_at_least": round(14 * kcal / 1000),
        "added_sugar_g_at_most": round(kcal * 0.10 / 4),
        "saturated_fat_g_at_most": round(kcal * 0.10 / 9),
        "sodium_mg_at_most": 2300,
        "note": "General guidance for healthy adults (about 14 g fiber per 1,000 kcal; added sugar and saturated fat "
        "under 10% of calories each; sodium under 2,300 mg), not a personal medical target.",
    }


def _food_rows(ctx: ToolContext, start: dt.date, end: dt.date) -> list:
    from sqlmodel import select

    from app.models.food import Food, FoodLog

    return list(ctx.session.exec(
        select(FoodLog, Food).join(Food, Food.id == FoodLog.food_id)
        .where(FoodLog.user_id == ctx.user.id, FoodLog.date >= start, FoodLog.date <= end)
    ).all())


def other_nutrients(rows: list) -> dict:
    """Fiber, sugar, sodium... eaten, from each food's values per 100 g/ml; counts entries whose food lacks a value."""
    totals = {k: 0.0 for k in OTHER_NUTRIENTS}
    unknown = {k: 0 for k in OTHER_NUTRIENTS}
    for log, food in rows:
        for k in OTHER_NUTRIENTS:
            value = getattr(food, k)
            if value is None:
                unknown[k] += 1
            else:
                totals[k] += value * log.amount_base / 100
    out: dict[str, Any] = {k: round(v) if k.endswith("_mg") else round(v, 1) for k, v in totals.items()}
    missing = {k: n for k, n in unknown.items() if n}
    if missing:
        out["entries_without_a_value"] = missing
    return out


def stage_averages(nights: list) -> dict | None:
    """Average minutes per stage over the nights a tracker measured stages (manual logs have none)."""
    measured = [n["stages"] for n in nights if n and n.get("stages")]
    if not measured:
        return None
    out: dict[str, Any] = {"nights_with_stages": len(measured)}
    for k in ("light", "deep", "rem", "awake"):
        values = [m[k] for m in measured if m.get(k) is not None]
        if values:
            out[f"{k}_minutes"] = round(sum(values) / len(values))
    return out


def _food_day(ctx: ToolContext, args: dict) -> Any:
    from app.routers.foods import food_day

    day = _date(args.get("date"), ctx)
    result = jsonable_encoder(food_day(ctx.user, ctx.session, day))
    targets = macro_targets(result.get("target_calories"))
    result["targets"] = targets
    if targets:
        result["eaten_minus_target"] = {k: round(result["totals"][k] - targets[k], 1) for k in MACROS}
    result["other_nutrients"] = other_nutrients(_food_rows(ctx, day, day))
    result["guidelines"] = guidelines(result.get("target_calories"))
    result["day_is_over"] = day < ctx.today
    return result


def _averages(per_day: list[dict], keys) -> dict:
    return {k: round(sum(d[k] for d in per_day) / len(per_day), 1) for k in keys} if per_day else {}


def _calories(ctx: ToolContext, args: dict) -> Any:
    from app.routers.analytics import calorie_series

    days = _int(args.get("days"), 14, 1, 90)
    result = jsonable_encoder(calorie_series(ctx.user, ctx.session, ctx.today - dt.timedelta(days=days - 1), ctx.today))
    labels, kcal = result["labels"], result["series"][0]["data"]
    macros = {m["name"]: m["data"] for m in result["macros"]}
    today = ctx.today.isoformat()
    per_day = [
        {"calories": kcal[i], "protein_g": macros["Protein"][i], "carbs_g": macros["Carbs"][i], "fat_g": macros["Fat"][i]}
        for i, label in enumerate(labels) if label < today and kcal[i] > 0
    ]
    targets = macro_targets(result.get("target_calories"))
    full = _averages(per_day, MACROS)
    result["full_days"] = {
        "days_with_food": len(per_day),
        "days_without_food": sum(1 for i, label in enumerate(labels) if label < today and kcal[i] == 0),
        "average_per_day": full,
        "average_minus_target": {k: round(full[k] - targets[k], 1) for k in MACROS} if full and targets else None,
        "note": "Averages over finished days with food logged; today is left out because it isn't over.",
    }
    result["targets"] = targets
    result["maintenance_calories"] = round(build_plan(ctx.profile).tdee)
    return result


def _food_summary(ctx: ToolContext, args: dict) -> Any:
    """Several finished days of eating: averages against the targets, other nutrients, the foods eaten most, meals."""
    days = _int(args.get("days"), 14, 1, 90)
    end = ctx.today - dt.timedelta(days=1)
    start = end - dt.timedelta(days=days - 1)
    rows = _food_rows(ctx, start, end)
    by_day: dict[dt.date, list] = {}
    for log, food in rows:
        by_day.setdefault(log.date, []).append((log, food))
    target_kcal = build_plan(ctx.profile).target_calories
    targets = macro_targets(target_kcal)
    per_day = [{k: sum(getattr(log, k) for log, _ in day_rows) for k in MACROS} for day_rows in by_day.values()]
    nutrients_per_day = [other_nutrients(day_rows) for day_rows in by_day.values()]
    average = _averages(per_day, MACROS)
    other_average = {}
    for k in OTHER_NUTRIENTS:
        if nutrients_per_day:
            mean = sum(n[k] for n in nutrients_per_day) / len(nutrients_per_day)
            other_average[k] = round(mean) if k.endswith("_mg") else round(mean, 1)
    foods: dict[int, dict] = {}
    for log, food in rows:
        f = foods.setdefault(food.id, {
            "food": food.name, "times_logged": 0, "days": set(), "calories": 0.0,
            "per_100": {k: getattr(food, k) for k in ("calories", "protein_g", "fiber_g", "sugar_g", "added_sugar_g",
                                                       "saturated_fat_g", "sodium_mg") if getattr(food, k) is not None},
        })
        f["times_logged"] += 1
        f["days"].add(log.date)
        f["calories"] += log.calories
    total_kcal = sum(d["calories"] for d in per_day) or 1
    most = sorted(foods.values(), key=lambda f: (-f["times_logged"], -f["calories"]))[:12]
    meal_days: dict[str, set] = {}
    for log, _ in rows:
        meal_days.setdefault(str(log.meal.value if hasattr(log.meal, "value") else log.meal), set()).add(log.date)
    return {
        "from": start, "to": end, "days": days,
        "days_with_food": len(per_day), "days_without_food": days - len(per_day),
        "targets": targets,
        "average_per_day": average,
        "average_minus_target": {k: round(average[k] - targets[k], 1) for k in MACROS} if average and targets else None,
        "days_within_10_percent_of_calorie_target": sum(
            1 for d in per_day if targets and abs(d["calories"] - targets["calories"]) <= 0.1 * targets["calories"]),
        "days_protein_target_reached": sum(1 for d in per_day if targets and d["protein_g"] >= targets["protein_g"]),
        "other_nutrients_average_per_day": other_average,
        "guidelines": guidelines(target_kcal),
        "maintenance_calories": round(build_plan(ctx.profile).tdee),
        "foods_eaten_most": [
            {"food": f["food"], "times_logged": f["times_logged"], "days": len(f["days"]),
             "share_of_calories_percent": round(100 * f["calories"] / total_kcal, 1), "per_100": f["per_100"]}
            for f in most
        ],
        "days_each_meal_was_logged": {meal: len(d) for meal, d in meal_days.items()},
        "note": "Finished days only (today is left out). Nutrient values per 100 g/ml come from the food database.",
    }


def _steps(ctx: ToolContext, args: dict) -> Any:
    """Daily steps from the phone (Apple Health / Health Connect): today so far, full-day averages, last sync."""
    from sqlmodel import select

    from app.models.health import HealthSync
    from app.services.health_sync import steps_history

    days = _int(args.get("days"), 14, 1, 90)
    history = steps_history(ctx.session, ctx.user.id, ctx.today, days)
    synced = ctx.session.exec(select(HealthSync).where(HealthSync.user_id == ctx.user.id)).all()
    last = max(synced, key=lambda r: r.last_sync_at, default=None)
    if not any(d.steps is not None for d in history):
        return {
            "steps_synced": False,
            "last_sync": jsonable_encoder({"source": last.source, "at": last.last_sync_at}) if last else None,
            "note": "No steps from the phone for these days. Steps come from Apple Health (iPhone) or Health Connect "
            "(Android): connect it on the Sleep screen, then open the app so it syncs. WHOOP doesn't send steps.",
        }
    full = [d for d in history if d.date < ctx.today and d.steps is not None]
    today = history[-1] if history and history[-1].date == ctx.today else None
    best = max(full, key=lambda d: d.steps, default=None)
    return {
        "steps_synced": True,
        "days": [{"date": d.date, "steps": d.steps} for d in history],  # null = no data that day (not 0)
        "today_so_far": today.steps if today else None,
        "full_days": {
            "days_with_steps": len(full),
            "days_without_data": sum(1 for d in history if d.date < ctx.today and d.steps is None),
            "average_per_day": round(sum(d.steps for d in full) / len(full)) if full else None,
            "best_day": {"date": best.date, "steps": best.steps} if best else None,
            "days_at_or_above_8000": sum(1 for d in full if d.steps >= 8000),
        },
        "source": next((d.source for d in reversed(history) if d.source), None),
        "last_sync": {"source": last.source, "at": last.last_sync_at} if last else None,
        "note": "Today's steps are as of the last sync; the phone syncs when the app is open. Averages are over "
        "finished days with data. 8,000+ steps a day is a common everyday activity goal, not a personal target.",
    }


def _patterns(ctx: ToolContext, _: dict) -> Any:
    """The same patterns as Progress > Patterns: e.g. sleep after training days vs rest days, with how sure."""
    from dataclasses import asdict

    from app.services import insights

    result = insights.compute(ctx.session, ctx.user, ctx.profile, ctx.today, ctx.tz_offset)
    return {
        "findings": [asdict(f) for f in result.findings],
        "not_enough_data_yet": result.not_enough,
        "note": "Side by side from the user's own data; a pattern doesn't show that one thing causes the other.",
    }


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


# Words that name a meal in the user's message (English and Arabic)
MEAL_WORDS = {
    "breakfast": ("breakfast", "brekkie", "morning meal", "فطور", "الفطور", "إفطار", "الإفطار", "فطار"),
    "lunch": ("lunch", "midday meal", "غداء", "الغداء", "غدا"),
    "dinner": ("dinner", "supper", "evening meal", "عشاء", "العشاء", "عشا"),
    "snack": ("snack", "snacks", "سناك", "وجبة خفيفة"),
}


def meals_named(text: str) -> set[str]:
    """The meals a message names, e.g. "add eggs for breakfast" -> {"breakfast"}."""
    lowered = f" {text.lower()} "
    found = set()
    for meal, words in MEAL_WORDS.items():
        for w in words:
            if w.isascii():
                if re.search(rf"\b{re.escape(w)}\b", lowered):
                    found.add(meal)
            elif w in lowered:
                found.add(meal)
    return found


def _meal_for(ctx: ToolContext, meal: Any) -> str:
    """The meal to log to: only one the user named. Never a guess (from the time of day or earlier messages)."""
    from app.models.food import Meal

    asked = "Nothing was logged. Ask the user which meal it's for (breakfast, lunch, dinner or snack), then log it."
    valid = {m.value for m in Meal}
    if ctx.question is None:  # not from a chat message (e.g. tests): the meal must still be given
        if meal in valid:
            return str(meal)
        raise ToolError(asked)
    named = meals_named(ctx.question)
    if meal in named:
        return str(meal)
    if len(named) == 1:  # the user named one meal; the model passed none or another
        return next(iter(named))
    raise ToolError(asked)


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


ARABIC_LETTERS = re.compile(r"[؀-ۿ]")
ESTIMATE_FIELDS = ("calories_per_100", "protein_per_100", "carbs_per_100", "fat_per_100")


def _estimated_food(ctx: ToolContext, name: str, args: dict):
    """A food nobody has data for: saved as the user's own food from the AI's own estimate (per 100 g or ml)."""
    from app.models.food import Food, FoodSource

    try:
        kcal, protein, carbs, fat = (float(args[k]) for k in ESTIMATE_FIELDS)
    except (KeyError, TypeError, ValueError):
        raise ToolError(
            f"'{name}' isn't in the food database or online, so nothing was logged. Call log_food again with your "
            "best estimate of its nutrition from your own knowledge: calories_per_100, protein_per_100, "
            "carbs_per_100 and fat_per_100 (per 100 g, or per 100 ml for a drink), serving_size (grams or ml in one "
            "normal serving, e.g. 50 for one egg) and is_liquid."
        )
    if not (0 <= kcal <= 900 and all(0 <= x <= 100 for x in (protein, carbs, fat)) and protein + carbs + fat <= 100.5):
        raise ToolError("Those numbers aren't possible per 100 g (at most 900 kcal and 100 g of protein, carbs and fat "
                        "together). Nothing was logged; check them and call log_food again.")
    is_liquid = bool(args.get("is_liquid"))
    from_macros = 4 * protein + 4 * carbs + 9 * fat
    if kcal < 0.6 * from_macros - 20 or (kcal > 1.5 * from_macros + 30 and not is_liquid):  # drinks may have alcohol
        raise ToolError(f"{kcal:g} kcal doesn't match the macros (they add up to about {from_macros:.0f} kcal). "
                        "Nothing was logged; check the numbers and call log_food again.")
    try:
        serving = float(args.get("serving_size") or 0)
    except (TypeError, ValueError):
        serving = 0.0
    food = Food(
        name=name[:1].upper() + name[1:120],
        brand="AI estimate",
        is_liquid=is_liquid,
        serving_size=serving if 1 <= serving <= 2000 else None,
        serving_unit=("ml" if is_liquid else "g") if 1 <= serving <= 2000 else None,
        calories=round(kcal, 1),
        protein_g=round(protein, 1),
        carbs_g=round(carbs, 1),
        fat_g=round(fat, 1),
        source=FoodSource.manual,
        owner_id=ctx.user.id,
    )
    ctx.session.add(food)
    ctx.session.commit()
    ctx.session.refresh(food)
    return food


def _find_food(ctx: ToolContext, name: str, args: dict | None = None):
    """The best match for a food name: the user's foods and the built-in list first, then online, and last the
    AI's own estimate (saved as the user's food, so it's found straight away next time)."""
    from sqlmodel import or_, select

    from app.models.food import Food
    from app.routers.foods import import_food
    from app.services.food_search import search_local

    foods = list(ctx.session.exec(select(Food).where(or_(Food.owner_id.is_(None), Food.owner_id == ctx.user.id))).all())
    local = search_local(foods, name, limit=1)
    if local:
        return local[0]
    if ARABIC_LETTERS.search(name):  # the built-in list is in English: "موزة" would miss "Banana" and go online
        raise ToolError(f"Nothing was logged: food names in the app are in English. Call log_food again with the "
                        f"food's plain English name (e.g. 'banana' for 'موزة'), whatever language the user writes in.")
    online = _search_online(name)
    if not online:
        return _estimated_food(ctx, name, args or {})
    return import_food(online[0], ctx.user, ctx.session)


def _log_food(ctx: ToolContext, args: dict) -> Any:
    from app.models.food import FoodAddedVia, FoodLogIn
    from app.routers.foods import log_food
    from app.services.units import SERVING, units_for

    name = str(args.get("food", "")).strip()
    if not name:
        raise ToolError("Say which food to log.")
    meal = _meal_for(ctx, args.get("meal"))  # before anything is saved: ask first if the meal isn't known
    food = _find_food(ctx, name, args)
    estimated = food.brand == "AI estimate"
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
        FoodLogIn(food_id=food.id, date=_date(args.get("date"), ctx), meal=meal,
                  quantity=quantity, unit=unit, added_via=FoodAddedVia.search),
        ctx.user, ctx.session,
    )
    amount = tr_count(TEXTS, "serving", quantity) if unit == SERVING else f"{quantity:g} {unit}"
    when = "" if entry.date == ctx.today else tr(TEXTS, "on_day", day=short_date(entry.date))
    summary = tr(TEXTS, "action_food", food=food.name, amount=amount, kcal=round(entry.calories),
                 estimate=tr(TEXTS, "ai_estimate") if estimated else "", meal=_meal(entry.meal), when=when)
    ctx.actions.append(Action("food", _plain(summary), "/food", [f"/food-logs/{entry.id}"]))
    result = {"logged": entry, "food": food.name, "serving_size": food.serving_size, "serving_unit": food.serving_unit}
    if estimated:
        result["note"] = ("This food isn't in any database: its numbers are an AI estimate, saved as the user's own "
                          "food. Tell them it's an estimate.")
    return result


def _remove_food(ctx: ToolContext, args: dict) -> Any:
    from app.models.food import FoodLog
    from app.routers.foods import delete_food_log

    entry_id = _int(args.get("entry_id"), 0, 0, 2**31)
    entry = ctx.session.get(FoodLog, entry_id)
    if entry is None or entry.user_id != ctx.user.id:
        raise ToolError("No food entry with that id. Look it up with get_food_day first.")
    calories, meal, day = entry.calories, entry.meal, entry.date
    delete_food_log(entry_id, ctx.user, ctx.session)
    ctx.actions.append(Action("removed", _plain(tr(TEXTS, "action_removed", meal=_meal(meal), kcal=round(calories), day=short_date(day))), "/food"))
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
    summary = tr(TEXTS, "action_sets", exercise=exercise_label(exercise), sets=tr_count(TEXTS, "set_count", sets), reps=reps,
                 load=load, started=tr(TEXTS, "started") if started else "")
    ctx.actions.append(Action("sets", _plain(summary), "/workouts", [f"/workouts/{workout_id}/sets/{s.id}" for s in added]))
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
    summary = tr(TEXTS, "action_weight", weight=f"{value:g} {unit.value}", day=short_date(entry.date))
    ctx.actions.append(Action("weight", _plain(summary), "/home", [f"/me/weight/{entry.id}"]))
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
    summary = tr(TEXTS, "action_sleep", bed=f"{data.bedtime:%H:%M}", wake=f"{data.wake_time:%H:%M}", h=h, m=f"{m:02d}",
                 day=short_date(entry.date))
    ctx.actions.append(Action("sleep", _plain(summary), "/sleep", [f"/sleep/{entry.id}"]))
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
         "them; null = not logged), the sleep goal, 7-day average vs the 7 days before, bedtime consistency, and "
         "stage_averages (deep, light, REM, awake) over the nights a tracker measured.",
         {"days": _DAYS}, _sleep),
    Tool("get_food_day",
         "Everything the user logged to eat on one day: calories and macros per item, the day's totals against the "
         "calorie, protein, carbs and fat targets, and fiber, sugar, saturated fat and sodium eaten.",
         {"date": {"type": "string", "description": "YYYY-MM-DD; default today."}}, _food_day),
    Tool("get_calorie_trend",
         "Daily calories and macros for recent days (0 = nothing logged that day), the targets, and full_days: "
         "averages over finished days with food (today left out) and how far they are from the targets.",
         {"days": _DAYS}, _calories),
    Tool("get_food_summary",
         "Eating over several finished days (default 14, today left out): average calories, protein, carbs and fat "
         "against the targets, fiber, sugar, saturated fat and sodium against general guidelines, the foods eaten "
         "most (with their nutrition per 100 g), and which meals get logged. Use it for eating habits and diet quality.",
         {"days": _DAYS}, _food_summary),
    Tool("get_steps",
         "Daily steps from the phone (Apple Health or Health Connect): each day (null = no data, not 0), today so far, "
         "the average and best day over finished days, the source, and when the phone last synced.",
         {"days": _DAYS}, _steps),
    Tool("get_patterns",
         "Patterns in the user's own data, the same as Progress > Patterns: sleep after training days vs rest days, "
         "lifts after good vs short sleep, which planned days get done, food logging and weight. Says how sure each is.",
         {}, _patterns),
    Tool("get_weekly_summary",
         "A Monday-Sunday week: sessions done vs planned, lifts vs last time, records, sleep, weight goal, points, "
         "and the same numbers for the week before it (previous_...), so one call compares two weeks. "
         "\"Last week vs the week before\" is weeks_ago=1; this week isn't over yet.",
         {"weeks_ago": {"type": "integer", "description": "0 = this week (not over yet), 1 = last week, 2 = the week before last."}}, _weekly_summary),
    Tool("get_points",
         "Wellness points: total, level, today's points with reasons, achievements, and how points are earned.",
         {}, _points),
    Tool("log_food",
         "Add a food to the user's food log right away. Finds the food by name (their foods, the built-in list, then "
         "online databases). Units: 'serving' (one normal portion, e.g. one banana or one egg), or g/kg/oz/lb for "
         "solids, ml/l/cup/fl_oz for drinks. If the food isn't found, the result says so and nothing is logged: call "
         "again with the *_per_100 estimates, serving_size and is_liquid filled in from your own knowledge.",
         {"food": {"type": "string", "description": "A plain food name in English, even when the user writes in "
                                                     "Arabic, e.g. 'banana', 'boiled egg', 'greek yogurt'"},
          "quantity": {"type": "number", "description": "How many units; default 1."},
          "unit": {"type": "string", "description": "serving, g, kg, oz, lb, ml, l, cup...; default serving."},
          "meal": {"type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"],
                   "description": "The meal the user named. If they didn't name one, ask them first."},
          "date": {"type": "string", "description": "YYYY-MM-DD; default today."},
          "calories_per_100": {"type": "number", "description": "Only for a food that wasn't found: kcal per 100 g (or 100 ml)."},
          "protein_per_100": {"type": "number", "description": "Only for a food that wasn't found: grams per 100 g/ml."},
          "carbs_per_100": {"type": "number", "description": "Only for a food that wasn't found: grams per 100 g/ml."},
          "fat_per_100": {"type": "number", "description": "Only for a food that wasn't found: grams per 100 g/ml."},
          "serving_size": {"type": "number", "description": "Only for a food that wasn't found: grams (or ml) in one normal serving."},
          "is_liquid": {"type": "boolean", "description": "Only for a food that wasn't found: true for a drink."}},
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
    language = "Arabic" if current_language() == "ar" else "English"
    return (f"(App note: today is {ctx.today.strftime('%A')} {ctx.today.isoformat()} for the user; their units are {units}; "
            f"app language: {language}. {tr(TEXTS, 'reply_in')})")


def _plain(text: str) -> str:
    """Action summaries are shown as they are, without the direction marks placeholders get in Arabic."""
    return text.replace("\u2068", "").replace("\u2069", "")


# English texts kept for code and tests that read them directly; replies use the request's language
CUT_OFF = TEXTS["en"]["cut_off"]
TOO_MANY_STEPS = TEXTS["en"]["too_many_steps"]
NO_ANSWER = TEXTS["en"]["no_answer"]


class ClaudeBackend:
    """Claude through Anthropic's API: the strongest answers; costs money per question."""

    provider = "claude"
    metered = True  # questions count toward ASSISTANT_DAILY_LIMIT

    def __init__(self, client: Any, model: str):
        self.client = client  # None when there is no API key
        self.model = model

    def problem(self) -> str | None:
        if self.client is None:
            return tr(TEXTS, "no_key")
        return None

    def ask(self, ctx: ToolContext, history: list[tuple[str, str]], question: str) -> Answer:
        import anthropic

        try:
            return self._ask(ctx, history, question)
        except anthropic.AuthenticationError:
            raise AssistantError(502, tr(TEXTS, "key_refused"))
        except anthropic.RateLimitError:
            raise AssistantError(429, tr(TEXTS, "busy"))
        except anthropic.APIStatusError as e:
            raise AssistantError(502, _plain(tr(TEXTS, "couldnt_answer", status=e.status_code, message=e.message)))
        except anthropic.APIConnectionError:
            raise AssistantError(502, tr(TEXTS, "unreachable"))

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
                return Answer(tr(TEXTS, "refusal"), used)
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
                text += tr(TEXTS, "cut_off")
            return Answer(text or tr(TEXTS, "no_answer"), used)
        return Answer(tr(TEXTS, "too_many_steps"), used)


# Small local models have less room: shorter history and tool results
OLLAMA_HISTORY_MESSAGES = 10
OLLAMA_TOOL_RESULT_CHARS = 8_000
OLLAMA_TOOLS = [{"type": "function", "function": {
    "name": t["name"], "description": t["description"], "parameters": t["input_schema"],
}} for t in TOOL_SCHEMAS]
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


def ollama_problem(http: httpx.Client, url: str, model: str) -> str | None:
    """Why Ollama can't run `model` right now (not running, model not pulled), or None when it can."""
    try:
        r = http.get(f"{url.rstrip('/')}/api/tags", timeout=3)
        r.raise_for_status()
        names = {m.get("name") for m in r.json().get("models", [])}
    except (httpx.HTTPError, ValueError):
        return _plain(tr(TEXTS, "ollama_off", url=url))
    if model not in names and f"{model}:latest" not in names:
        return _plain(tr(TEXTS, "ollama_no_model", model=model))
    return None


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
        return ollama_problem(self.http, self.url, self.model)

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
                text += tr(TEXTS, "cut_off")
            return Answer(text or tr(TEXTS, "no_answer"), used)
        return Answer(tr(TEXTS, "too_many_steps"), used)

    def _chat(self, messages: list[dict], tools: bool = True, answer_format: dict | None = None, timeout: float = 300) -> dict:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"num_ctx": self.num_ctx},  # room for the tools, the history and the data
        }
        if tools:
            body["tools"] = OLLAMA_TOOLS
        if answer_format:
            body["format"] = answer_format
            body["think"] = False  # a short structured answer: no need for the model to think first
        try:
            r = self.http.post(
                f"{self.url}/api/chat",
                json=body,
                timeout=timeout,  # a local model can take a while, especially the first time it loads
            )
        except httpx.TimeoutException:
            raise AssistantError(504, tr(TEXTS, "ollama_slow"))
        except httpx.HTTPError:
            raise AssistantError(502, _plain(tr(TEXTS, "ollama_off", url=self.url)))
        if r.status_code == 404:
            raise AssistantError(502, _plain(tr(TEXTS, "ollama_no_model", model=self.model)))
        if r.status_code >= 400:
            try:
                detail = r.json().get("error", r.text)
            except ValueError:
                detail = r.text
            raise AssistantError(502, _plain(tr(TEXTS, "ollama_failed", detail=detail)))
        return r.json()


# Gemini and others that speak OpenAI's chat format take the same tool list Ollama does
OPENAI_TOOLS = OLLAMA_TOOLS
GEMINI_MAX_TOKENS = 8_000


class GeminiBackend:
    """Google Gemini through its OpenAI-compatible API: free tier, decent answers, a small shared daily quota.

    When the main model is out of quota (429), the rest of the question goes to the fallback model, which has
    its own quota on Google's side.
    """

    provider = "gemini"
    metered = True  # questions count toward GEMINI_DAILY_LIMIT
    retry_pause = 1.5  # seconds before trying a busy (503) model again

    def __init__(self, http: httpx.Client, url: str, api_key: str, model: str, fallback_model: str | None = None):
        self.http = http
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.fallback_model = fallback_model if fallback_model and fallback_model != model else None

    def problem(self) -> str | None:
        return None if self.api_key else tr(TEXTS, "gemini_no_key")

    def ask(self, ctx: ToolContext, history: list[tuple[str, str]], question: str) -> Answer:
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages += [{"role": role, "content": text} for role, text in history[-HISTORY_MESSAGES:]]
        messages.append({"role": "user", "content": f"{question}\n\n{_context_note(ctx)}"})
        used: list[str] = []
        model = self.model
        for _ in range(MAX_TOOL_ROUNDS):
            reply, model = self._chat(messages, model)
            choice = (reply.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            calls = message.get("tool_calls") or []
            if calls:
                # sent back unchanged: Gemini needs the "thought signature" it put in each tool call
                messages.append({k: v for k, v in message.items() if k in ("role", "content", "tool_calls")})
                for call in calls:
                    fn = call.get("function") or {}
                    name, args = fn.get("name", ""), fn.get("arguments") or {}
                    if isinstance(args, str):
                        try:
                            args = json.loads(args) if args.strip() else {}
                        except ValueError:
                            args = {}
                    used.append(name)
                    text, is_error = run_tool(ctx, name, args if isinstance(args, dict) else {})
                    messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": f"Error: {text}" if is_error else text})
                continue
            text = _THINK.sub("", message.get("content") or "").strip()
            if choice.get("finish_reason") == "length":
                text += tr(TEXTS, "cut_off")
            return Answer(text or tr(TEXTS, "no_answer"), used)
        return Answer(tr(TEXTS, "too_many_steps"), used)

    def _chat(self, messages: list[dict], model: str) -> tuple[dict, str]:
        """One model call; returns the reply and the model that gave it.

        Google often answers 503 ("high demand") for a moment: that's tried once more after a short pause. A model
        still busy or out of quota (429) hands the rest of the question to the fallback model.
        """
        r = self._post(messages, model)
        if r.status_code in (500, 503):
            time.sleep(self.retry_pause)
            r = self._post(messages, model)
        if r.status_code in (429, 500, 503) and self.fallback_model and model != self.fallback_model:
            model = self.fallback_model
            r = self._post(messages, model)
        if r.status_code in (401, 403):
            raise AssistantError(502, tr(TEXTS, "gemini_key_refused"))
        if r.status_code == 429:
            raise AssistantError(429, tr(TEXTS, "gemini_quota"))
        if r.status_code >= 500:
            raise AssistantError(503, tr(TEXTS, "busy"))
        if r.status_code >= 400:
            raise AssistantError(502, _plain(tr(TEXTS, "couldnt_answer", status=r.status_code, message=_error_text(r))))
        try:
            return r.json(), model
        except ValueError:
            raise AssistantError(502, _plain(tr(TEXTS, "couldnt_answer", status=r.status_code, message=r.text[:200])))

    def _post(self, messages: list[dict], model: str) -> httpx.Response:
        try:
            return self.http.post(
                f"{self.url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": model, "messages": messages, "tools": OPENAI_TOOLS, "max_tokens": GEMINI_MAX_TOKENS},
                timeout=90,
            )
        except httpx.TimeoutException:
            raise AssistantError(504, tr(TEXTS, "gemini_slow"))
        except httpx.HTTPError:
            raise AssistantError(502, tr(TEXTS, "unreachable"))


def _error_text(r: httpx.Response) -> str:
    """The message in an OpenAI-style error body ({"error": {"message": ...}}, sometimes inside a list)."""
    try:
        body = r.json()
    except ValueError:
        return r.text[:200]
    if isinstance(body, list) and body:
        body = body[0]
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or error)[:200]
    return str(error or body)[:200]
