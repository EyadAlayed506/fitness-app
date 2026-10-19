"""Weekly progress summary, from logged data only. Anything without data is left out (None), not zero.

Weeks run Monday to Sunday in the user's local time. "Planned" uses the user's current training days,
since earlier schedules aren't stored.
"""

import datetime as dt
from dataclasses import dataclass, field

from sqlmodel import Session, select

from app.models.points import PointAward
from app.models.user import Profile, WeightEntry
from app.services.activity import (
    DoneWorkout,
    completed_workouts,
    planned_days,
    sleep_goal,
    sleep_nights,
)
from app.services.calculations import estimated_1rm
from app.services.plan import build_plan
from app.services.schedule import effective_training_days

HISTORY_WEEKS = 8
NOTE = (
    "Sleep and training are shown side by side to help you spot patterns. "
    "This summary doesn't say that one caused a change in the other."
)


@dataclass
class DayStatus:
    date: dt.date
    planned: bool
    trained: bool
    future: bool


@dataclass
class TopSet:
    weight_kg: float
    reps: int
    date: dt.date


@dataclass
class ExerciseWeek:
    exercise_id: int
    name: str
    sets: int
    top_set: TopSet
    previous_top_set: TopSet | None  # the last time before this week, if any
    best_e1rm_kg: float | None  # only for sets with weight
    previous_e1rm_kg: float | None
    record: str | None  # "Best estimated 1RM yet" / "Heaviest weight yet", beating all earlier history


@dataclass
class SleepWeek:
    nights_logged: int
    average_minutes: int
    goal_minutes: int
    nights_meeting_goal: int
    from_whoop: int
    from_health_connect: int
    logged_by_hand: int
    previous_average_minutes: int | None  # None when last week has no nights
    previous_nights_logged: int


@dataclass
class WeightWeek:
    latest_kg: float
    previous_latest_kg: float | None  # last weigh-in before this week
    change_kg: float | None
    target_kg: float
    direction: str  # "lose" | "gain" | "maintain"
    to_target_kg: float  # positive: still to go


@dataclass
class WeekCount:
    week_start: dt.date
    planned: int
    completed: int


@dataclass
class WeeklySummary:
    week_start: dt.date
    week_end: dt.date
    current_week: bool
    days: list[DayStatus]
    planned: int
    planned_so_far: int
    completed: int  # days with a finished workout
    completed_on_plan: int  # of those, on a planned day
    workouts: int
    previous_completed: int | None
    sets: int
    volume_kg: float
    previous_volume_kg: float | None
    exercises: list[ExerciseWeek]
    records: list[str]
    sleep: SleepWeek | None
    weight: WeightWeek | None
    points: int
    previous_points: int
    history: list[WeekCount]
    notes: list[str] = field(default_factory=lambda: [NOTE])


def _volume(workouts: list[DoneWorkout]) -> float:
    return round(sum(s.reps * s.weight_kg for w in workouts for s, _ in w.sets), 1)


def _top(sets, day: dt.date) -> TopSet:
    s = max(sets, key=lambda x: (x.weight_kg, x.reps))
    return TopSet(s.weight_kg, s.reps, day)


def _exercise_weeks(this_week: list[DoneWorkout], before: list[DoneWorkout]) -> list[ExerciseWeek]:
    out = []
    by_ex: dict[int, list] = {}
    names: dict[int, str] = {}
    last_day: dict[int, dt.date] = {}
    for w in this_week:
        for s, ex in w.sets:
            by_ex.setdefault(ex.id, []).append(s)
            names[ex.id] = ex.name
            last_day[ex.id] = w.day
    for ex_id, sets in by_ex.items():
        earlier = [(s, w.day) for w in before for s, ex in w.sets if ex.id == ex_id]
        prev_top = None
        if earlier:
            last = max(d for _, d in earlier)
            prev_top = _top([s for s, d in earlier if d == last], last)
        weighted = [s for s in sets if s.weight_kg > 0 and s.reps > 0]
        best = max((estimated_1rm(s.weight_kg, s.reps) for s in weighted), default=None)
        prev_weighted = [s for s, _ in earlier if s.weight_kg > 0 and s.reps > 0]
        prev_best = max((estimated_1rm(s.weight_kg, s.reps) for s in prev_weighted), default=None)
        heaviest = max((s.weight_kg for s in weighted), default=0)
        prev_heaviest = max((s.weight_kg for s in prev_weighted), default=0)
        record = None
        if prev_weighted and best is not None:
            if best > prev_best + 0.05:
                record = "Best estimated 1RM yet"
            elif heaviest > prev_heaviest:
                record = "Heaviest weight yet"
        out.append(
            ExerciseWeek(
                exercise_id=ex_id,
                name=names[ex_id],
                sets=len(sets),
                top_set=_top(sets, last_day[ex_id]),
                previous_top_set=prev_top,
                best_e1rm_kg=round(best, 1) if best else None,
                previous_e1rm_kg=round(prev_best, 1) if prev_best else None,
                record=record,
            )
        )
    return sorted(out, key=lambda e: (-e.sets, e.name))


def _avg(values: list[int]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def weekly_summary(
    session: Session, profile: Profile, today: dt.date, monday: dt.date, tz_offset: int | None, since: dt.date
) -> WeeklySummary:
    """`since`: the day the user signed up. Days before it don't count as planned."""
    uid = profile.user_id
    sunday = monday + dt.timedelta(days=6)
    current = monday <= today <= sunday
    last_day = min(sunday, today)
    days_ = effective_training_days(profile)

    # all finished workouts up to the end of this week (earlier ones for comparisons and records)
    all_workouts = completed_workouts(session, uid, dt.date(2000, 1, 1), sunday, tz_offset)
    this_week = [w for w in all_workouts if monday <= w.day <= sunday]
    before = [w for w in all_workouts if w.day < monday]
    prev_week = [w for w in before if w.day >= monday - dt.timedelta(days=7)]

    planned = planned_days(days_, max(monday, since), sunday)
    trained_days = {w.day for w in this_week}
    days = [
        DayStatus(d, d.weekday() in days_ and d >= since, d in trained_days, d > today)
        for d in (monday + dt.timedelta(days=i) for i in range(7))
    ]

    # Sleep: this week's nights against last week's
    nights = sleep_nights(session, uid, monday - dt.timedelta(days=7), last_day)
    this_nights = [n for d, n in nights.items() if d >= monday]
    prev_nights = [n for d, n in nights.items() if d < monday]
    goal = sleep_goal(profile)
    sleep = None
    if this_nights:
        sleep = SleepWeek(
            nights_logged=len(this_nights),
            average_minutes=_avg([n.duration_minutes for n in this_nights]),
            goal_minutes=goal.minutes,
            nights_meeting_goal=sum(n.duration_minutes >= goal.minutes for n in this_nights),
            from_whoop=sum(n.source == "whoop" for n in this_nights),
            from_health_connect=sum(n.source == "health_connect" for n in this_nights),
            logged_by_hand=sum(n.source == "manual" for n in this_nights),
            previous_average_minutes=_avg([n.duration_minutes for n in prev_nights]),
            previous_nights_logged=len(prev_nights),
        )

    # Body weight toward the goal
    weigh_ins = session.exec(
        select(WeightEntry).where(WeightEntry.user_id == uid, WeightEntry.date <= last_day).order_by(WeightEntry.date)
    ).all()
    weight = None
    this_weights = [w for w in weigh_ins if w.date >= monday]
    if this_weights:
        plan = build_plan(profile)
        earlier = [w for w in weigh_ins if w.date < monday]
        latest = this_weights[-1].weight_kg
        prev = earlier[-1].weight_kg if earlier else None
        weight = WeightWeek(
            latest_kg=latest,
            previous_latest_kg=prev,
            change_kg=round(latest - prev, 1) if prev is not None else None,
            target_kg=plan.optimal_weight_kg,
            direction=plan.direction,
            to_target_kg=round(abs(plan.optimal_weight_kg - latest), 1) if plan.direction != "maintain" else 0,
        )

    awards = session.exec(
        select(PointAward).where(PointAward.user_id == uid, PointAward.day >= monday - dt.timedelta(days=7), PointAward.day <= sunday)
    ).all()

    exercises = _exercise_weeks(this_week, before)
    history = []
    for k in range(HISTORY_WEEKS - 1, -1, -1):
        m = monday - dt.timedelta(weeks=k)
        end = min(m + dt.timedelta(days=6), today)
        history.append(
            WeekCount(m, len(planned_days(days_, max(m, since), m + dt.timedelta(days=6))),
                      len({w.day for w in all_workouts if m <= w.day <= end}))
        )
    return WeeklySummary(
        week_start=monday,
        week_end=sunday,
        current_week=current,
        days=days,
        planned=len(planned),
        planned_so_far=len([d for d in planned if d <= today]),
        completed=len(trained_days),
        completed_on_plan=len([d for d in trained_days if d.weekday() in days_]),
        workouts=len(this_week),
        previous_completed=len({w.day for w in prev_week}) if before else None,
        sets=sum(len(w.sets) for w in this_week),
        volume_kg=_volume(this_week),
        previous_volume_kg=_volume(prev_week) if prev_week else None,
        exercises=exercises,
        records=[e.name for e in exercises if e.record],
        sleep=sleep,
        weight=weight,
        points=sum(a.points for a in awards if a.day >= monday),
        previous_points=sum(a.points for a in awards if a.day < monday),
        history=history,
    )


