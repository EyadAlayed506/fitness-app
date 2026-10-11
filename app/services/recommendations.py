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

from app.models.sleep import SleepEntry
from app.services.activity import DoneWorkout, SleepGoal
from app.services.routine import Routine, RoutineDay
from app.services.schedule import WEEKDAY_NAMES
from app.services.units import BODY_WEIGHT_TO_KG

DISCLAIMER = (
    "Suggestions based on what you've logged, not medical advice. "
    "Listen to your body, and talk to a doctor about pain, illness or injury."
)

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
    return f"{h} h {m:02d} min" if m else f"{h} h"


def _sleep_source(entry: SleepEntry) -> str:
    return "Sleep from WHOOP" if entry.source == "whoop" else "Sleep you logged"


def _next_session(ctx: Context) -> RoutineDay | None:
    for k in range(1, 8):
        weekday = (ctx.today.weekday() + k) % 7
        day = next((d for d in ctx.routine.days if d.weekday_index == weekday), None)
        if day:
            return day
    return None


# ---------- rules ----------


def plan_for_today(ctx: Context) -> list[Recommendation]:
    plan_source = "Your training days"
    session = ctx.today_session
    if ctx.trained_today:
        nxt = _next_session(ctx)
        return [
            Recommendation(
                "plan_for_today",
                "rest",
                "Done for today",
                "You've already logged a workout today. Rest and recovery are when you get stronger."
                + (f" Next session: {nxt.weekday}, {nxt.title}." if nxt else ""),
                reasons=["A finished workout is logged for today"],
                sources=["Your workouts", plan_source],
            )
        ]
    if session is None:
        nxt = _next_session(ctx)
        return [
            Recommendation(
                "plan_for_today",
                "rest",
                "Rest day",
                "Today isn't one of your training days. Resting is part of the plan; a walk or light "
                "stretching is fine if you feel like moving." + (f" Next session: {nxt.weekday}, {nxt.title}." if nxt else ""),
                reasons=[f"{WEEKDAY_NAMES[ctx.today.weekday()]} isn't one of your training days"],
                sources=[plan_source],
            )
        ]
    names = ", ".join(e.name for e in session.exercises[:3])
    more = len(session.exercises) - 3
    return [
        Recommendation(
            "plan_for_today",
            "plan",
            f"Today: {session.title}",
            f"{len(session.exercises)} exercises: {names}{f' and {more} more' if more > 0 else ''}.",
            reasons=[f"{session.weekday} is one of your training days"],
            sources=[plan_source],
        )
    ]


def sleep_last_night(ctx: Context) -> list[Recommendation]:
    night = ctx.last_night
    if night is None or ctx.today_session is None or ctx.trained_today or not ctx.short_sleep:
        return []
    goal = ctx.sleep_goal
    goal_text = f"your {_hm(goal.minutes)} goal" if goal.custom else f"the {_hm(goal.minutes)} recommended for your age"
    return [
        Recommendation(
            "sleep_last_night",
            "lighter",
            "Short night: consider going lighter",
            "If you feel tired, you could do fewer sets or use a bit less weight today. "
            "It's only a suggestion; your plan hasn't changed.",
            reasons=[f"You slept {_hm(night.duration_minutes)} last night, under {goal_text}"],
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
                "Low recovery: consider an easier session",
                "A longer warm-up and lighter weights may suit you better today. Your plan hasn't changed.",
                reasons=[f"WHOOP recovery is {score}% (WHOOP's low range is below {WHOOP_LOW_RECOVERY}%)"],
                sources=["WHOOP recovery"],
            )
        ]
    if night.recovery_score >= WHOOP_HIGH_RECOVERY and not ctx.short_sleep:
        return [
            Recommendation(
                "whoop_recovery",
                "info",
                "Good recovery",
                "A good day to train as planned.",
                reasons=[f"WHOOP recovery is {score}% (WHOOP's high range is {WHOOP_HIGH_RECOVERY}% and up)"],
                sources=["WHOOP recovery"],
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
    advice = (
        "No need to make it up by doing two sessions in one day: just carry on with today's session."
        if ctx.today_session
        else "No need to squeeze in extra sessions: pick up again on your next training day."
    )
    return [
        Recommendation(
            "missed_sessions",
            "info",
            f"{done} of {len(planned)} planned session{'s' if len(planned) > 1 else ''} so far this week",
            advice,
            reasons=[f"{len(planned)} training day{'s' if len(planned) > 1 else ''} so far this week, {done} with a workout logged"],
            sources=["Your training days", "Your workouts"],
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
        if weight <= 0:
            msg = "Make it harder: slow down each rep or pause at the hardest point."
        else:
            msg = "Try a small step up in weight (the smallest jump available) and aim for the bottom of the rep range again."
        out.append(
            Recommendation(
                "progression",
                "progress",
                f"Ready to progress: {planned.name}",
                msg,
                reasons=[
                    f"Last time ({last.day.strftime('%a %d %b')}) you did {len(sets)} sets of {top}+ reps"
                    + (f" at {ctx.weight(weight)}" if weight > 0 else "")
                    + f", the top of your {planned.reps} range"
                ],
                sources=["Your workouts"],
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
