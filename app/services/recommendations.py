"""Today's workout suggestions, from simple rules over what the user has logged. No AI.

Each rule looks at one thing (the plan, last night's sleep, WHOOP recovery, missed sessions, recent
sets) and returns zero or more suggestions, each with the reasons and the data it used. A rule whose
data is missing returns nothing: no data is never treated as a bad sign. Suggestions never change the
plan; the user decides.

To add a rule: write a function `(ctx) -> list[Recommendation]` and add it to RULES.
"""

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass, field

from app.i18n import Table, short_date, tr, tr_count, weekday_name
from app.models.sleep import SOURCE_NAMES, SleepEntry
from app.services.activity import DoneWorkout, SleepGoal
from app.services.routine import Routine, RoutineDay
from app.services.units import BODY_WEIGHT_TO_KG

# Everything the user reads, in the language of the request (app.i18n)
TEXTS: Table = {
    "en": {
        "disclaimer": "Suggestions based on what you've logged, not medical advice. "
        "Listen to your body, and talk to a doctor about pain, illness or injury.",
        "list_sep": ", ",
        "hm": "{h} h {m} min",
        "h": "{h} h",
        "sleep_you_logged": "Sleep you logged",
        "sleep_from": "Sleep from {source}",
        "your_training_days": "Your training days",
        "your_workouts": "Your workouts",
        "whoop_recovery": "WHOOP recovery",
        "next_session": " Next session: {day}, {title}.",
        "done_title": "Done for today",
        "done_message": "You've already logged a workout today. Rest and recovery are when you get stronger.",
        "done_reason": "A finished workout is logged for today",
        "rest_title": "Rest day",
        "rest_message": "Today isn't one of your training days. Resting is part of the plan; a walk or light "
        "stretching is fine if you feel like moving.",
        "rest_reason": "{day} isn't one of your training days",
        "plan_title": "Today: {title}",
        "plan_message": "{count}: {names}.",
        "plan_message_more": "{count}: {names} and {more} more.",
        "exercise_count": "{n} exercise|{n} exercises",
        "plan_reason": "{day} is one of your training days",
        "your_goal": "your {goal} goal",
        "recommended_goal": "the {goal} recommended for your age",
        "short_title": "Short night: consider going lighter",
        "short_message": "If you feel tired, you could do fewer sets or use a bit less weight today. "
        "It's only a suggestion; your plan hasn't changed.",
        "short_reason": "You slept {slept} last night, under {goal}",
        "low_title": "Low recovery: consider an easier session",
        "low_message": "A longer warm-up and lighter weights may suit you better today. Your plan hasn't changed.",
        "low_reason": "WHOOP recovery is {score}% (WHOOP's low range is below {limit}%)",
        "good_title": "Good recovery",
        "good_message": "A good day to train as planned.",
        "good_reason": "WHOOP recovery is {score}% (WHOOP's high range is {limit}% and up)",
        "missed_advice_today": "No need to make it up by doing two sessions in one day: just carry on with today's session.",
        "missed_advice_rest": "No need to squeeze in extra sessions: pick up again on your next training day.",
        "missed_title": "{done} of {planned} so far this week",
        "planned_sessions": "{n} planned session|{n} planned sessions",
        "missed_reason": "{days} so far this week, {done} with a workout logged",
        "training_days": "{n} training day|{n} training days",
        "harder": "Make it harder: slow down each rep or pause at the hardest point.",
        "step_up": "Try a small step up in weight (the smallest jump available) and aim for the bottom of the rep range again.",
        "progress_title": "Ready to progress: {name}",
        "progress_reason": "Last time ({day}) you did {sets} of {top}+ reps{at}, the top of your {range} range",
        "sets": "{n} set|{n} sets",
        "at_weight": " at {weight}",
    },
    "ar": {
        "disclaimer": "اقتراحات مبنية على ما سجّلته، وليست نصيحة طبية. استمع إلى جسمك، واستشر طبيباً عند الألم أو المرض أو الإصابة.",
        "list_sep": "، ",
        "hm": "{h} س {m} د",
        "h": "{h} س",
        "sleep_you_logged": "نوم سجّلته",
        "sleep_from": "نوم من {source}",
        "your_training_days": "أيام تمرينك",
        "your_workouts": "تمارينك",
        "whoop_recovery": "تعافي WHOOP",
        "next_session": " الحصة التالية: {day}، {title}.",
        "done_title": "انتهيت لهذا اليوم",
        "done_message": "سجّلت تمريناً اليوم بالفعل. الراحة والتعافي هما وقت اكتساب القوة.",
        "done_reason": "تمرين مكتمل مسجّل لهذا اليوم",
        "rest_title": "يوم راحة",
        "rest_message": "اليوم ليس من أيام تمرينك. الراحة جزء من الخطة؛ ولا بأس بالمشي أو التمدد الخفيف إن رغبت في الحركة.",
        "rest_reason": "{day} ليس من أيام تمرينك",
        "plan_title": "اليوم: {title}",
        "plan_message": "{count}: {names}.",
        "plan_message_more": "{count}: {names} و{more} أخرى.",
        "exercise_count": "لا تمارين|تمرين واحد|تمرينان|{n} تمارين|{n} تمريناً|{n} تمرين",
        "plan_reason": "{day} من أيام تمرينك",
        "your_goal": "هدفك {goal}",
        "recommended_goal": "{goal} الموصى بها لعمرك",
        "short_title": "ليلة قصيرة: فكّر في تمرين أخف",
        "short_message": "إن شعرت بالتعب، يمكنك أداء مجموعات أقل أو استخدام وزن أقل قليلاً اليوم. إنه مجرد اقتراح؛ خطتك لم تتغير.",
        "short_reason": "نمت {slept} الليلة الماضية، أقل من {goal}",
        "low_title": "تعافٍ منخفض: فكّر في حصة أسهل",
        "low_message": "قد يناسبك اليوم إحماء أطول وأوزان أخف. خطتك لم تتغير.",
        "low_reason": "تعافي WHOOP ‏{score}% (النطاق المنخفض في WHOOP أقل من {limit}%)",
        "good_title": "تعافٍ جيد",
        "good_message": "يوم مناسب للتمرين كما هو مخطط.",
        "good_reason": "تعافي WHOOP ‏{score}% (النطاق المرتفع في WHOOP من {limit}% فأكثر)",
        "missed_advice_today": "لا حاجة لتعويضها بحصتين في يوم واحد: تابع حصة اليوم فقط.",
        "missed_advice_rest": "لا حاجة لحشر حصص إضافية: استأنف في يوم تمرينك القادم.",
        "missed_title": "{done} من {planned} حتى الآن هذا الأسبوع",
        "planned_sessions": "لا حصص مخططة|حصة مخططة واحدة|حصتين مخططتين|{n} حصص مخططة|{n} حصة مخططة|{n} حصة مخططة",
        "missed_reason": "{days} حتى الآن هذا الأسبوع، سُجّل تمرين في {done} منها",
        "training_days": "لا أيام تمرين|يوم تمرين واحد|يوما تمرين|{n} أيام تمرين|{n} يوم تمرين|{n} يوم تمرين",
        "harder": "زِد الصعوبة: أبطئ كل تكرار أو توقّف عند أصعب نقطة.",
        "step_up": "جرّب زيادة صغيرة في الوزن (أصغر زيادة متاحة) واستهدف أدنى نطاق التكرارات من جديد.",
        "progress_title": "جاهز للتقدّم: {name}",
        "progress_reason": "في المرة الماضية ({day}) أدّيت {sets} من {top}+ تكرار{at}، وهو أعلى نطاقك {range}",
        "sets": "لا مجموعات|مجموعة واحدة|مجموعتين|{n} مجموعات|{n} مجموعة|{n} مجموعة",
        "at_weight": " بوزن {weight}",
    },
}

# The English disclaimer, for code and tests that read it directly
DISCLAIMER = TEXTS["en"]["disclaimer"]


def disclaimer() -> str:
    return tr(TEXTS, "disclaimer")

# Thresholds, kept together so they're easy to review and change
SHORT_SLEEP_MARGIN_MINUTES = 60  # this far under the sleep goal counts as a short night
WHOOP_LOW_RECOVERY = 34  # WHOOP's own bands: red below 34, yellow 34-66, green 67 and up
WHOOP_HIGH_RECOVERY = 67
PROGRESSION_LOOKBACK_DAYS = 42


@dataclass
class Recommendation:
    id: str  # which rule made it
    kind: str  # "plan" | "rest" | "lighter" | "progress" | "info"
    title: str
    message: str
    reasons: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)  # the data used, e.g. "Sleep log (WHOOP)"


@dataclass
class Context:
    today: dt.date
    routine: Routine
    sleep_goal: SleepGoal
    last_night: SleepEntry | None
    # finished workouts from the start of this week (or the lookback window, whichever is earlier) to today
    workouts: list[DoneWorkout]
    imperial: bool = False
    since: dt.date | None = None  # the day the user signed up: earlier days were never planned

    def weight(self, kg: float) -> str:
        return f"{kg / BODY_WEIGHT_TO_KG['lb']:.1f} lb".replace(".0 lb", " lb") if self.imperial else f"{kg:g} kg"

    @property
    def today_session(self) -> RoutineDay | None:
        return next((d for d in self.routine.days if d.weekday_index == self.today.weekday()), None)

    @property
    def trained_today(self) -> bool:
        return any(w.day == self.today for w in self.workouts)

    @property
    def short_sleep(self) -> bool:
        n = self.last_night
        return n is not None and n.duration_minutes <= self.sleep_goal.minutes - SHORT_SLEEP_MARGIN_MINUTES

    @property
    def low_recovery(self) -> bool:
        n = self.last_night
        return n is not None and n.recovery_score is not None and n.recovery_score < WHOOP_LOW_RECOVERY


def _hm(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return _plain(tr(TEXTS, "hm", h=h, m=f"{m:02d}")) if m else _plain(tr(TEXTS, "h", h=h))


def _plain(text: str) -> str:
    """Without the invisible direction marks, for a piece that goes inside another sentence."""
    return text.replace("\u2068", "").replace("\u2069", "")


def _sleep_source(entry: SleepEntry) -> str:
    return tr(TEXTS, "sleep_you_logged") if entry.source == "manual" else tr(TEXTS, "sleep_from", source=SOURCE_NAMES[entry.source])


def _next_text(nxt: RoutineDay | None) -> str:
    return tr(TEXTS, "next_session", day=weekday_name(nxt.weekday_index), title=nxt.title) if nxt else ""


def _next_session(ctx: Context) -> RoutineDay | None:
    for k in range(1, 8):
        weekday = (ctx.today.weekday() + k) % 7
        day = next((d for d in ctx.routine.days if d.weekday_index == weekday), None)
        if day:
            return day
    return None


# ---------- rules ----------


def plan_for_today(ctx: Context) -> list[Recommendation]:
    plan_source = tr(TEXTS, "your_training_days")
    session = ctx.today_session
    if ctx.trained_today:
        nxt = _next_session(ctx)
        return [
            Recommendation(
                "plan_for_today",
                "rest",
                tr(TEXTS, "done_title"),
                tr(TEXTS, "done_message") + _next_text(nxt),
                reasons=[tr(TEXTS, "done_reason")],
                sources=[tr(TEXTS, "your_workouts"), plan_source],
            )
        ]
    if session is None:
        nxt = _next_session(ctx)
        return [
            Recommendation(
                "plan_for_today",
                "rest",
                tr(TEXTS, "rest_title"),
                tr(TEXTS, "rest_message") + _next_text(nxt),
                reasons=[tr(TEXTS, "rest_reason", day=weekday_name(ctx.today.weekday()))],
                sources=[plan_source],
            )
        ]
    names = tr(TEXTS, "list_sep").join(e.name for e in session.exercises[:3])
    more = len(session.exercises) - 3
    count = _plain(tr_count(TEXTS, "exercise_count", len(session.exercises)))
    message = (
        tr(TEXTS, "plan_message_more", count=count, names=names, more=more) if more > 0 else tr(TEXTS, "plan_message", count=count, names=names)
    )
    return [
        Recommendation(
            "plan_for_today",
            "plan",
            tr(TEXTS, "plan_title", title=session.title),
            message,
            reasons=[tr(TEXTS, "plan_reason", day=weekday_name(session.weekday_index))],
            sources=[plan_source],
        )
    ]


def sleep_last_night(ctx: Context) -> list[Recommendation]:
    night = ctx.last_night
    if night is None or ctx.today_session is None or ctx.trained_today or not ctx.short_sleep:
        return []
    goal = ctx.sleep_goal
    goal_text = _plain(tr(TEXTS, "your_goal" if goal.custom else "recommended_goal", goal=_hm(goal.minutes)))
    return [
        Recommendation(
            "sleep_last_night",
            "lighter",
            tr(TEXTS, "short_title"),
            tr(TEXTS, "short_message"),
            reasons=[tr(TEXTS, "short_reason", slept=_hm(night.duration_minutes), goal=goal_text)],
            sources=[_sleep_source(night)],
        )
    ]


def whoop_recovery(ctx: Context) -> list[Recommendation]:
    night = ctx.last_night
    if night is None or night.recovery_score is None or ctx.today_session is None or ctx.trained_today:
        return []
    score = round(night.recovery_score)
    if night.recovery_score < WHOOP_LOW_RECOVERY:
        return [
            Recommendation(
                "whoop_recovery",
                "lighter",
                tr(TEXTS, "low_title"),
                tr(TEXTS, "low_message"),
                reasons=[tr(TEXTS, "low_reason", score=score, limit=WHOOP_LOW_RECOVERY)],
                sources=[tr(TEXTS, "whoop_recovery")],
            )
        ]
    if night.recovery_score >= WHOOP_HIGH_RECOVERY and not ctx.short_sleep:
        return [
            Recommendation(
                "whoop_recovery",
                "info",
                tr(TEXTS, "good_title"),
                tr(TEXTS, "good_message"),
                reasons=[tr(TEXTS, "good_reason", score=score, limit=WHOOP_HIGH_RECOVERY)],
                sources=[tr(TEXTS, "whoop_recovery")],
            )
        ]
    return []


def missed_sessions(ctx: Context) -> list[Recommendation]:
    """Planned sessions earlier this week that didn't happen. Never suggests making them up."""
    monday = ctx.today - dt.timedelta(days=ctx.today.weekday())
    first = max(monday, ctx.since) if ctx.since else monday
    planned = [
        monday + dt.timedelta(days=d)
        for d in ctx.routine.training_days
        if first <= monday + dt.timedelta(days=d) < ctx.today
    ]
    if not planned:
        return []
    done = min(len(planned), len({w.day for w in ctx.workouts if first <= w.day < ctx.today}))
    missed = len(planned) - done
    if missed <= 0:
        return []
    advice = tr(TEXTS, "missed_advice_today" if ctx.today_session else "missed_advice_rest")
    return [
        Recommendation(
            "missed_sessions",
            "info",
            tr(TEXTS, "missed_title", done=done, planned=_plain(tr_count(TEXTS, "planned_sessions", len(planned)))),
            advice,
            reasons=[tr(TEXTS, "missed_reason", days=_plain(tr_count(TEXTS, "training_days", len(planned))), done=done)],
            sources=[tr(TEXTS, "your_training_days"), tr(TEXTS, "your_workouts")],
        )
    ]


def _top_of_range(reps: str) -> int | None:
    try:
        return int(reps.split("-")[-1])
    except ValueError:
        return None


def progression(ctx: Context) -> list[Recommendation]:
    """Exercises in today's session where every set last time reached the top of the rep range."""
    session = ctx.today_session
    if session is None or ctx.trained_today or ctx.short_sleep or ctx.low_recovery:
        return []  # no "go heavier" on a day we suggested going lighter
    out = []
    for planned in session.exercises:
        top = _top_of_range(planned.reps)
        last = next(
            (w for w in reversed(ctx.workouts) if any(s.exercise_id == planned.exercise_id for s, _ in w.sets)),
            None,
        )
        if top is None or last is None:
            continue
        sets = [s for s, _ in last.sets if s.exercise_id == planned.exercise_id]
        weights = {s.weight_kg for s in sets}
        if len(sets) < planned.sets or len(weights) != 1 or not all(s.reps >= top for s in sets):
            continue
        weight = sets[0].weight_kg
        msg = tr(TEXTS, "harder" if weight <= 0 else "step_up")
        out.append(
            Recommendation(
                "progression",
                "progress",
                tr(TEXTS, "progress_title", name=planned.name),
                msg,
                reasons=[
                    tr(TEXTS, "progress_reason", day=short_date(last.day), sets=_plain(tr_count(TEXTS, "sets", len(sets))), top=top,
                       at=_plain(tr(TEXTS, "at_weight", weight=ctx.weight(weight))) if weight > 0 else "", range=planned.reps)
                ],
                sources=[tr(TEXTS, "your_workouts")],
            )
        )
    return out


RULES: list[Callable[[Context], list[Recommendation]]] = [
    plan_for_today,
    sleep_last_night,
    whoop_recovery,
    missed_sessions,
    progression,
]


def recommend(ctx: Context) -> list[Recommendation]:
    return [rec for rule in RULES for rec in rule(ctx)]
