"""Chart-ready time series: {labels: [...], series: [{name, data}]}."""

from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import select

from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.exercise import BODY_REGION, Exercise
from app.models.food import FoodLog
from app.models.points import PointAward
from app.models.sleep import SleepEntry
from app.models.user import Profile, WeightEntry
from app.models.workout import WorkoutSession, WorkoutSet
from app.services.activity import TzOffset, local_today, sleep_goal, week_start
from app.services.calculations import estimated_1rm
from app.services.plan import build_plan
from app.services.weekly import WeeklySummary, weekly_summary

router = APIRouter(prefix="/analytics", tags=["analytics"])

COMPARE_MIN_NIGHTS = 3  # nights needed in each week before comparing averages
CONSISTENCY_MIN_NIGHTS = 3


@router.get("/weight")
def weight_series(user: CurrentUser, session: SessionDep):
    entries = session.exec(
        select(WeightEntry).where(WeightEntry.user_id == user.id).order_by(WeightEntry.date)
    ).all()
    labels = [e.date.isoformat() for e in entries]
    weights = [e.weight_kg for e in entries]
    # 7-day moving average: mean of the weigh-ins from the last 7 days
    avg = []
    for e in entries:
        window = [x.weight_kg for x in entries if e.date - timedelta(days=6) <= x.date <= e.date]
        avg.append(round(sum(window) / len(window), 2))
    profile = session.get(Profile, user.id)
    plan = build_plan(profile) if profile else None
    return {
        "labels": labels,
        "series": [{"name": "Weight", "data": weights}, {"name": "7-day average", "data": avg}],
        "target_weight_kg": plan.optimal_weight_kg if plan else None,
        "healthy_range_kg": [plan.healthy_weight_min_kg, plan.healthy_weight_max_kg] if plan else None,
    }


@router.get("/calories")
def calorie_series(
    user: CurrentUser,
    session: SessionDep,
    start: date | None = Query(default=None, alias="from"),
    end: date | None = Query(default=None, alias="to"),
):
    end = end or date.today()
    start = start or end - timedelta(days=13)
    if start > end:
        raise HTTPException(status_code=422, detail="'from' must be before 'to'")
    logs = session.exec(
        select(FoodLog).where(FoodLog.user_id == user.id, FoodLog.date >= start, FoodLog.date <= end)
    ).all()
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    totals = {d: defaultdict(float) for d in days}
    for log in logs:
        for k in ("calories", "protein_g", "carbs_g", "fat_g"):
            totals[log.date][k] += getattr(log, k)
    profile = session.get(Profile, user.id)
    target = build_plan(profile).target_calories if profile else None

    def col(k):
        return [round(totals[d][k], 1) for d in days]

    return {
        "labels": [d.isoformat() for d in days],
        "series": [{"name": "Calories", "data": col("calories")}],
        "macros": [
            {"name": "Protein", "data": col("protein_g")},
            {"name": "Carbs", "data": col("carbs_g")},
            {"name": "Fat", "data": col("fat_g")},
        ],
        "target_calories": target,
    }


def _user_sets(session, user_id: int, exercise_id: int | None = None):
    query = (
        select(WorkoutSet, WorkoutSession.started_at, Exercise)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .join(Exercise, Exercise.id == WorkoutSet.exercise_id)
        .where(WorkoutSession.user_id == user_id)
        .order_by(WorkoutSession.started_at)
    )
    if exercise_id is not None:
        query = query.where(WorkoutSet.exercise_id == exercise_id)
    return session.exec(query).all()


@router.get("/exercises")
def logged_exercises(user: CurrentUser, session: SessionDep):
    """Exercises the user has logged, most-logged first (for the progress chart picker)."""
    counts: dict[int, dict] = {}
    for _, _, ex in _user_sets(session, user.id):
        row = counts.setdefault(ex.id, {"id": ex.id, "name": ex.name, "sets": 0})
        row["sets"] += 1
    return sorted(counts.values(), key=lambda r: -r["sets"])


@router.get("/exercise/{exercise_id}")
def exercise_progress(exercise_id: int, user: CurrentUser, session: SessionDep):
    """Per workout: best estimated 1RM, heaviest weight and total volume for one exercise."""
    exercise = session.get(Exercise, exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    per_day: dict[str, dict] = {}
    for s, started_at, _ in _user_sets(session, user.id, exercise_id):
        d = per_day.setdefault(started_at.date().isoformat(), {"e1rm": 0.0, "max": 0.0, "volume": 0.0})
        d["e1rm"] = max(d["e1rm"], estimated_1rm(s.weight_kg, s.reps))
        d["max"] = max(d["max"], s.weight_kg)
        d["volume"] += s.reps * s.weight_kg
    labels = list(per_day)
    return {
        "exercise": exercise.name,
        "labels": labels,
        "series": [
            {"name": "Estimated 1RM", "data": [round(per_day[d]["e1rm"], 1) for d in labels]},
            {"name": "Heaviest set", "data": [round(per_day[d]["max"], 1) for d in labels]},
        ],
        "volume": [round(per_day[d]["volume"]) for d in labels],
    }


@router.get("/volume")
def weekly_volume(user: CurrentUser, session: SessionDep, weeks: int = Query(default=8, ge=1, le=52)):
    """Training volume (reps x weight) per week, split by body region."""
    today = date.today()
    this_monday = today - timedelta(days=today.weekday())
    mondays = [this_monday - timedelta(weeks=i) for i in range(weeks - 1, -1, -1)]
    regions = ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core"]
    volume = {m: defaultdict(float) for m in mondays}
    for s, started_at, ex in _user_sets(session, user.id):
        d = started_at.date()
        monday = d - timedelta(days=d.weekday())
        if monday in volume:
            # bodyweight sets count reps x 1 so they still show up
            volume[monday][BODY_REGION[ex.muscle_group]] += s.reps * (s.weight_kg or 1)
    return {
        "labels": [m.isoformat() for m in mondays],
        "series": [{"name": r, "data": [round(volume[m][r]) for m in mondays]} for r in regions],
    }


def _clock_minutes(moment: datetime, around: int) -> int:
    """Minutes since midnight, shifted so times near `around` (e.g. bedtimes near midnight) don't wrap."""
    m = moment.hour * 60 + moment.minute
    return m + 1440 if m < around - 720 else m - 1440 if m > around + 720 else m


def _spread(values: list[int]) -> int | None:
    """Typical distance from the middle time, in minutes (mean absolute deviation from the median)."""
    if len(values) < CONSISTENCY_MIN_NIGHTS:
        return None
    mid = sorted(values)[len(values) // 2]
    return round(sum(abs(v - mid) for v in values) / len(values))


def _night(e: SleepEntry | None, total: int, awarded: set[date]) -> dict | None:
    if e is None:
        return None
    stages = e.source != "manual" and any(
        x is not None for x in (e.light_minutes, e.deep_minutes, e.rem_minutes, e.awake_minutes)
    )
    return {
        "minutes": total,
        "main_minutes": e.duration_minutes,
        "bedtime": e.bedtime.isoformat(),
        "wake_time": e.wake_time.isoformat(),
        "source": e.source,
        "quality": e.quality,
        # sleep stages only when the tracker measured them; never estimated for manual logs
        "stages": {
            "light": e.light_minutes, "deep": e.deep_minutes, "rem": e.rem_minutes, "awake": e.awake_minutes,
        } if stages else None,
        "recovery_score": e.recovery_score,
        "points": e.date in awarded,
    }


@router.get("/sleep")
def sleep_series(
    user: CurrentUser,
    session: SessionDep,
    days: int = Query(default=14, ge=1, le=90),
    tz_offset: TzOffset = None,
):
    """Sleep per night with the goal, 7-day averages against the 7 days before, and bedtime consistency.

    Nights without data are null (shown as "not logged"), never zero.
    """
    end = local_today(tz_offset)
    start = end - timedelta(days=days - 1)
    span_start = min(start, end - timedelta(days=13))  # always load two weeks for the comparison
    entries = session.exec(
        select(SleepEntry).where(SleepEntry.user_id == user.id, SleepEntry.date >= span_start, SleepEntry.date <= end)
    ).all()
    all_nights = [span_start + timedelta(days=i) for i in range((end - span_start).days + 1)]
    minutes = {d: 0 for d in all_nights}
    qualities: dict[date, list[int]] = {d: [] for d in all_nights}
    main: dict[date, SleepEntry] = {}
    for e in entries:  # naps on the same day add up
        minutes[e.date] += e.duration_minutes
        if e.quality:
            qualities[e.date].append(e.quality)
        if e.date not in main or e.duration_minutes > main[e.date].duration_minutes:
            main[e.date] = e
    nights = [start + timedelta(days=i) for i in range(days)]

    hours = [round(minutes[d] / 60, 2) if minutes[d] else None for d in nights]
    quality = [round(sum(q) / len(q), 1) if q else None for q in (qualities[d] for d in nights)]
    week = [d for d in all_nights if d > end - timedelta(days=7)]
    prev_week = [d for d in all_nights if end - timedelta(days=14) < d <= end - timedelta(days=7)]
    last_week = [minutes[d] / 60 for d in week if minutes[d]]
    last_week_q = [q for d in week for q in qualities[d]]
    prev = [minutes[d] / 60 for d in prev_week if minutes[d]]

    profile = session.get(Profile, user.id)
    goal = sleep_goal(profile)
    awarded = set(
        session.exec(
            select(PointAward.day).where(PointAward.user_id == user.id, PointAward.rule == "sleep_goal", PointAward.day >= start)
        ).all()
    )
    week_main = [main[d] for d in week if d in main]
    return {
        "labels": [d.isoformat() for d in nights],
        "series": [{"name": "Hours slept", "data": hours}],
        "quality": quality,
        "nights": [_night(main.get(d), minutes[d], awarded) for d in nights],
        "average_hours_7d": round(sum(last_week) / len(last_week), 2) if last_week else None,
        "average_quality_7d": round(sum(last_week_q) / len(last_week_q), 1) if last_week_q else None,
        "nights_logged_7d": len(last_week),
        # the 7 days before, only when both weeks have enough nights to compare
        "average_hours_prev_7d": round(sum(prev) / len(prev), 2)
        if len(prev) >= COMPARE_MIN_NIGHTS and len(last_week) >= COMPARE_MIN_NIGHTS else None,
        "nights_logged_prev_7d": len(prev),
        "nights_at_goal_7d": sum(minutes[d] >= goal.minutes for d in week if minutes[d]),
        "goal_minutes": goal.minutes,
        "goal_custom": goal.custom,
        "recommended_hours": list(goal.recommended_hours),
        # how much bedtime and wake-up time moved around over the last 7 nights (main sleep only)
        "bedtime_spread_minutes": _spread([_clock_minutes(e.bedtime, 0) for e in week_main]),
        "wake_spread_minutes": _spread([_clock_minutes(e.wake_time, 7 * 60) for e in week_main]),
    }


@router.get("/weekly-summary", response_model=WeeklySummary)
def read_weekly_summary(
    profile: CurrentProfile,
    session: SessionDep,
    tz_offset: TzOffset = None,
    week: date | None = Query(default=None, description="Any day in the week; default this week"),
):
    """One week (Monday to Sunday) compared with the week before: workouts against the plan, lifts,
    records, sleep, weight and points."""
    today = local_today(tz_offset)
    monday = week_start(week or today)
    if monday > today:
        raise HTTPException(status_code=422, detail="That week hasn't started yet")
    return weekly_summary(session, profile, today, monday, tz_offset)
