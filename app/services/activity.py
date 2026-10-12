"""Read-only helpers over what a user has logged, shared by recommendations, the weekly summary and points.

Workouts are stored with UTC timestamps; the app sends its UTC offset (minutes east of UTC) so that
"today" and "this week" are the user's own days. Sleep is already stored by the local morning it ended.
"""

import datetime as dt
import json
from dataclasses import dataclass, field
from typing import Annotated

from fastapi import Query
from sqlmodel import Session, select

from app.models.exercise import Exercise
from app.models.sleep import SleepEntry
from app.models.snap import CustomDay
from app.models.user import Profile
from app.models.workout import WorkoutSession, WorkoutSet
from app.services.calculations import age_on, recommended_sleep_hours
from app.services.plan import build_plan
from app.services.routine import Routine, RoutineExercise, generate_routine
from app.services.schedule import effective_training_days, parse_day_choices

# Query parameter the app sends: -new Date().getTimezoneOffset(). Without it, the server's own time zone is used.
TzOffset = Annotated[
    int | None,
    Query(ge=-14 * 60, le=14 * 60, description="The user's UTC offset in minutes (e.g. 120 for UTC+2)"),
]


def local_date(moment: dt.datetime, tz_offset: int | None) -> dt.date:
    if moment.tzinfo is None:  # SQLite hands back naive UTC
        moment = moment.replace(tzinfo=dt.UTC)
    if tz_offset is None:
        return moment.astimezone().date()
    return (moment.astimezone(dt.UTC) + dt.timedelta(minutes=tz_offset)).date()


def local_today(tz_offset: int | None) -> dt.date:
    return local_date(dt.datetime.now(dt.UTC), tz_offset)


def week_start(day: dt.date) -> dt.date:
    """The Monday of the week `day` is in."""
    return day - dt.timedelta(days=day.weekday())


@dataclass
class DoneWorkout:
    """A finished workout with at least one set."""

    id: int
    day: dt.date  # the user's local date
    started_at: dt.datetime
    sets: list[tuple[WorkoutSet, Exercise]] = field(default_factory=list)


def completed_workouts(
    session: Session, user_id: int, start: dt.date, end: dt.date, tz_offset: int | None
) -> list[DoneWorkout]:
    """Finished workouts with sets whose local date is between start and end (inclusive), oldest first."""
    lo = dt.datetime.combine(start - dt.timedelta(days=1), dt.time(), dt.UTC)
    hi = dt.datetime.combine(end + dt.timedelta(days=2), dt.time(), dt.UTC)
    rows = session.exec(
        select(WorkoutSession, WorkoutSet, Exercise)
        .join(WorkoutSet, WorkoutSet.session_id == WorkoutSession.id)
        .join(Exercise, Exercise.id == WorkoutSet.exercise_id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.ended_at.is_not(None),  # type: ignore[union-attr]
            WorkoutSession.started_at >= lo,
            WorkoutSession.started_at < hi,
        )
        .order_by(WorkoutSession.started_at, WorkoutSet.id)
    ).all()
    workouts: dict[int, DoneWorkout] = {}
    for w, s, ex in rows:
        day = local_date(w.started_at, tz_offset)
        if start <= day <= end:
            workouts.setdefault(w.id, DoneWorkout(w.id, day, w.started_at)).sets.append((s, ex))
    return list(workouts.values())


def sleep_nights(session: Session, user_id: int, start: dt.date, end: dt.date) -> dict[dt.date, SleepEntry]:
    """The main sleep (the longest entry) of each night that has one, keyed by the morning it ended."""
    entries = session.exec(
        select(SleepEntry).where(SleepEntry.user_id == user_id, SleepEntry.date >= start, SleepEntry.date <= end)
    ).all()
    nights: dict[dt.date, SleepEntry] = {}
    for e in entries:
        if e.date not in nights or e.duration_minutes > nights[e.date].duration_minutes:
            nights[e.date] = e
    return nights


@dataclass
class SleepGoal:
    minutes: int
    custom: bool  # False: the lower end of the amount recommended for the user's age
    recommended_hours: tuple[int, int]


def sleep_goal(profile: Profile | None) -> SleepGoal:
    low, high = recommended_sleep_hours(age_on(profile.birth_date)) if profile else (7, 9)
    if profile and profile.sleep_goal_minutes:
        return SleepGoal(profile.sleep_goal_minutes, True, (low, high))
    return SleepGoal(low * 60, False, (low, high))


def user_routine(session: Session, profile: Profile) -> Routine:
    catalogue = list(session.exec(select(Exercise)).all())
    routine = generate_routine(
        catalogue,
        effective_training_days(profile),
        profile.minutes_per_session,
        profile.equipment,
        build_plan(profile).direction,
        parse_day_choices(profile.day_plan),
    )
    apply_custom_days(session, profile.user_id, routine, catalogue)
    return routine


def apply_custom_days(session: Session, user_id: int, routine: Routine, catalogue: list[Exercise]) -> None:
    """Training days with the user's own exercises (e.g. imported from a screenshot) use those instead."""
    custom = {c.weekday: c for c in session.exec(select(CustomDay).where(CustomDay.user_id == user_id)).all()}
    if not custom:
        return
    by_id = {e.id: e for e in catalogue}
    rest = 60 if routine.reps == "10-15" else 90
    for day in routine.days:
        c = custom.get(day.weekday_index)
        if c is None:
            continue
        items = []
        for x in json.loads(c.exercises):
            ex = by_id.get(x.get("exercise_id"))
            if ex is not None:
                items.append(RoutineExercise(ex.id, ex.name, ex.muscle_group, int(x.get("sets", 3)), str(x.get("reps", routine.reps)), ex.default_rest_seconds or rest))
        if items:
            day.exercises = items
            day.title = c.title
            day.custom_name = True
            day.custom_exercises = True


def planned_days(training_days: list[int], start: dt.date, end: dt.date) -> list[dt.date]:
    """Dates between start and end (inclusive) that fall on one of the training weekdays."""
    return [
        start + dt.timedelta(days=i)
        for i in range((end - start).days + 1)
        if (start + dt.timedelta(days=i)).weekday() in training_days
    ]
