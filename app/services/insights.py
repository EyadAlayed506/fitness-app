"""Personal insights: patterns in the user's own data, with how much data each one rests on.

Rules:
- A finding is only shown when each side has enough data (MIN_* below); otherwise the app says what
  more data would unlock it.
- Each comes with its sample sizes, and "clear" or "could be chance" from a simple two-sample test
  (Welch's t; |t| >= 2 counts as clear). Counts (like sessions done per weekday) are just counts.
- Nothing claims a cause: these are things that go together in this person's data.
"""

import datetime as dt
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

from sqlmodel import Session, select

from app.models.food import FoodLog
from app.models.sleep import SleepEntry
from app.models.user import Profile, User, WeightEntry
from app.models.workout import WorkoutSession, WorkoutSet
from app.services.activity import local_date, sleep_goal
from app.services.calculations import estimated_1rm
from app.services.schedule import WEEKDAY_NAMES, effective_training_days

MIN_SESSIONS = 5  # per side, for sleep and strength
MIN_NIGHTS = 5  # per side, for sleep after training
MIN_WEEKS = 3  # per side, for food logging and weight
MIN_PLANNED = 4  # planned sessions per weekday, for follow-through
LOOKBACK_DAYS = 120
CAUTION = "From your own data, side by side. It doesn't show that one causes the other."


@dataclass
class Group:
    label: str
    n: int
    value: float
    unit: str


@dataclass
class Finding:
    id: str
    title: str
    text: str
    groups: list[Group]
    strength: str  # "clear", "could be chance", or "count"
    caution: str = CAUTION


@dataclass
class Result:
    findings: list[Finding] = field(default_factory=list)
    not_enough: list[str] = field(default_factory=list)


def welch_t(a: list[float], b: list[float]) -> float:
    if len(a) < 2 or len(b) < 2:
        return 0.0
    va, vb = statistics.variance(a), statistics.variance(b)
    se = math.sqrt(va / len(a) + vb / len(b))
    return (statistics.mean(a) - statistics.mean(b)) / se if se > 0 else 0.0


def strength_of(a: list[float], b: list[float]) -> str:
    return "clear" if abs(welch_t(a, b)) >= 2 else "could be chance"


def _hours(minutes: int) -> str:
    return f"{minutes // 60} h" if minutes % 60 == 0 else f"{minutes // 60} h {minutes % 60:02d}"


def compute(session: Session, user: User, profile: Profile, today: dt.date, tz_offset: int | None) -> Result:
    result = Result()
    since = today - dt.timedelta(days=LOOKBACK_DAYS)
    imperial = profile.unit_system == "imperial"

    # finished workouts with their sets, by local date
    rows = session.exec(
        select(WorkoutSet, WorkoutSession)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .where(WorkoutSession.user_id == user.id, WorkoutSession.ended_at.is_not(None))
    ).all()
    workouts: dict[int, dict] = {}
    for s, w in rows:
        day = local_date(w.started_at, tz_offset)
        if day < since:
            continue
        info = workouts.setdefault(w.id, {"day": day, "best": {}})
        e1rm = estimated_1rm(s.weight_kg, s.reps)
        if e1rm > info["best"].get(s.exercise_id, 0):
            info["best"][s.exercise_id] = e1rm
    trained_days = {w["day"] for w in workouts.values()}

    sleep_minutes: dict[dt.date, int] = defaultdict(int)  # night ending on that morning
    for e in session.exec(select(SleepEntry).where(SleepEntry.user_id == user.id, SleepEntry.date >= since)).all():
        sleep_minutes[e.date] += e.duration_minutes
    goal = sleep_goal(profile).minutes

    _sleep_and_strength(result, workouts, sleep_minutes, goal)
    _sleep_after_training(result, sleep_minutes, trained_days)
    _weekday_follow_through(result, profile, user, trained_days, today, tz_offset)
    _logging_and_weight(result, session, user, today, imperial)
    return result


def _sleep_and_strength(result: Result, workouts: dict[int, dict], sleep_minutes: dict, goal: int) -> None:
    """Top sets (each exercise against its own usual level) after nights at the sleep goal vs shorter ones."""
    per_exercise: dict[int, list[float]] = defaultdict(list)
    for w in workouts.values():
        for ex, v in w["best"].items():
            if v > 0:
                per_exercise[ex].append(v)
    usual = {ex: statistics.median(vs) for ex, vs in per_exercise.items() if len(vs) >= 3}
    rested, short = [], []
    for w in workouts.values():
        ratios = [v / usual[ex] for ex, v in w["best"].items() if ex in usual and v > 0]
        night = sleep_minutes.get(w["day"])
        if not ratios or night is None:
            continue
        (rested if night >= goal else short).append(statistics.mean(ratios))
    label = f"Sleep and strength (nights of {_hours(goal)}+ vs shorter)"
    if len(rested) < MIN_SESSIONS or len(short) < MIN_SESSIONS:
        result.not_enough.append(
            f"{label}: needs {MIN_SESSIONS} workouts after each kind of night with sleep logged (you have {len(rested)} and {len(short)})."
        )
        return
    a, b = statistics.mean(rested), statistics.mean(short)
    diff = (a / b - 1) * 100
    if abs(diff) < 0.5:
        text = f"Your top sets were about the same after nights of {_hours(goal)}+ sleep as after shorter nights ({len(rested)} vs {len(short)} sessions)."
    else:
        text = (
            f"Your top sets were {abs(diff):.0f}% {'heavier' if diff > 0 else 'lighter'} after nights of "
            f"{_hours(goal)}+ sleep ({len(rested)} vs {len(short)} sessions)."
        )
    result.findings.append(Finding(
        "sleep_strength",
        "Sleep and strength",
        text,
        [Group(f"After {_hours(goal)}+ sleep", len(rested), round(a * 100, 1), "% of usual"),
         Group("After shorter nights", len(short), round(b * 100, 1), "% of usual")],
        strength_of(rested, short),
    ))


def _sleep_after_training(result: Result, sleep_minutes: dict, trained_days: set) -> None:
    after_training, after_rest = [], []
    for morning, minutes in sleep_minutes.items():
        (after_training if morning - dt.timedelta(days=1) in trained_days else after_rest).append(minutes)
    label = "Sleep after training days"
    if len(after_training) < MIN_NIGHTS or len(after_rest) < MIN_NIGHTS:
        result.not_enough.append(
            f"{label}: needs {MIN_NIGHTS} nights after training days and {MIN_NIGHTS} after rest days (you have {len(after_training)} and {len(after_rest)})."
        )
        return
    a, b = statistics.mean(after_training), statistics.mean(after_rest)
    diff = round(a - b)
    text = (
        f"You slept about the same after training days as after rest days ({len(after_training)} vs {len(after_rest)} nights)."
        if abs(diff) < 3
        else f"You slept {abs(diff)} min {'longer' if diff > 0 else 'less'} after training days than after rest days "
        f"({len(after_training)} vs {len(after_rest)} nights)."
    )
    result.findings.append(Finding(
        "sleep_after_training",
        label,
        text,
        [Group("After training", len(after_training), round(a), "min"), Group("After rest days", len(after_rest), round(b), "min")],
        strength_of(after_training, after_rest),
    ))


def _weekday_follow_through(result: Result, profile: Profile, user: User, trained_days: set, today: dt.date, tz_offset: int | None) -> None:
    start = max(local_date(user.created_at, tz_offset), today - dt.timedelta(weeks=8))
    rates = []
    for weekday in effective_training_days(profile):
        planned = [start + dt.timedelta(days=i) for i in range((today - start).days)
                   if (start + dt.timedelta(days=i)).weekday() == weekday]
        if len(planned) >= MIN_PLANNED:
            done = sum(d in trained_days for d in planned)
            rates.append((done / len(planned), weekday, done, len(planned)))
    if len(rates) < 2:
        result.not_enough.append(
            f"Training days: needs {MIN_PLANNED} weeks of plan on at least two training days to compare them."
        )
        return
    rates.sort()
    low, high = rates[0], rates[-1]
    if high[0] - low[0] < 0.3:
        text = f"You do your planned sessions about as often on every training day (best {WEEKDAY_NAMES[high[1]]}, {high[2]} of {high[3]})."
    else:
        text = (
            f"You did {high[2]} of {high[3]} planned {WEEKDAY_NAMES[high[1]]} sessions, "
            f"but {low[2]} of {low[3]} on {WEEKDAY_NAMES[low[1]]}s."
        )
    result.findings.append(Finding(
        "weekday_follow_through",
        "Which training days happen",
        text,
        [Group(WEEKDAY_NAMES[high[1]], high[3], high[2], "done"), Group(WEEKDAY_NAMES[low[1]], low[3], low[2], "done")],
        "count",
        caution="Counts of your planned days in the last 8 weeks.",
    ))


def _logging_and_weight(result: Result, session: Session, user: User, today: dt.date, imperial: bool) -> None:
    this_monday = today - dt.timedelta(days=today.weekday())
    weeks = [this_monday - dt.timedelta(weeks=k) for k in range(12, 0, -1)]  # complete weeks only
    logged = defaultdict(set)
    for d in session.exec(select(FoodLog.date).where(FoodLog.user_id == user.id, FoodLog.date >= weeks[0])).all():
        logged[d - dt.timedelta(days=d.weekday())].add(d)
    weigh_ins = sorted(session.exec(select(WeightEntry.date, WeightEntry.weight_kg).where(WeightEntry.user_id == user.id)).all())

    def last_before(day: dt.date) -> float | None:
        before = [w for d, w in weigh_ins if d < day]
        return before[-1] if before else None

    most, fewer = [], []
    for monday in weeks:
        end = monday + dt.timedelta(days=7)
        start_w = last_before(monday)
        if start_w is None or not any(monday <= d < end for d, _ in weigh_ins):
            continue  # needs a weigh-in before the week and one during it
        change = last_before(end) - start_w
        (most if len(logged[monday]) >= 5 else fewer).append(change)
    label = "Food logging and weight"
    if len(most) < MIN_WEEKS or len(fewer) < MIN_WEEKS:
        result.not_enough.append(
            f"{label}: needs {MIN_WEEKS} weeks with food logged on 5+ days and {MIN_WEEKS} with fewer, all with weigh-ins (you have {len(most)} and {len(fewer)})."
        )
        return
    factor = 1 / 0.45359237 if imperial else 1
    unit = "lb" if imperial else "kg"
    a, b = statistics.mean(most) * factor, statistics.mean(fewer) * factor
    fmt = lambda v: f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.1f} {unit}"  # noqa: E731
    result.findings.append(Finding(
        "logging_weight",
        label,
        f"In weeks you logged food on 5+ days your weight changed {fmt(a)} a week on average, vs {fmt(b)} in other weeks "
        f"({len(most)} vs {len(fewer)} weeks).",
        [Group("Logged 5+ days", len(most), round(a, 2), f"{unit}/week"), Group("Fewer days", len(fewer), round(b, 2), f"{unit}/week")],
        strength_of(most, fewer),
    ))
