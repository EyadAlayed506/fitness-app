"""Chart-ready time series: {labels: [...], series: [{name, data}]}."""

from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import select

from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.exercise import BODY_REGION, Exercise
from app.models.food import FoodLog
from app.models.sleep import SleepEntry
from app.models.user import Profile, WeightEntry
from app.models.workout import WorkoutSession, WorkoutSet
from app.services.activity import TzOffset, local_today, week_start
from app.services.calculations import age_on, estimated_1rm, recommended_sleep_hours
from app.services.plan import build_plan
from app.services.weekly import WeeklySummary, weekly_summary

router = APIRouter(prefix="/analytics", tags=["analytics"])


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


@router.get("/sleep")
def sleep_series(user: CurrentUser, session: SessionDep, days: int = Query(default=14, ge=1, le=90)):
    """Hours slept and sleep quality per night, plus 7-day averages and the recommended range."""
    end = date.today()
    start = end - timedelta(days=days - 1)
    entries = session.exec(
        select(SleepEntry).where(SleepEntry.user_id == user.id, SleepEntry.date >= start, SleepEntry.date <= end)
    ).all()
    nights = [start + timedelta(days=i) for i in range(days)]
    minutes = {d: 0 for d in nights}
    qualities: dict[date, list[int]] = {d: [] for d in nights}
    for e in entries:  # naps on the same day add up
        minutes[e.date] += e.duration_minutes
        if e.quality:
            qualities[e.date].append(e.quality)

    hours = [round(minutes[d] / 60, 2) if minutes[d] else None for d in nights]
    quality = [round(sum(q) / len(q), 1) if q else None for q in (qualities[d] for d in nights)]
    last_week = [h for d, h in zip(nights, hours) if h is not None and d > end - timedelta(days=7)]
    last_week_q = [q for d, q in zip(nights, quality) if q is not None and d > end - timedelta(days=7)]

    profile = session.get(Profile, user.id)
    low, high = recommended_sleep_hours(age_on(profile.birth_date)) if profile else (7, 9)
    return {
        "labels": [d.isoformat() for d in nights],
        "series": [{"name": "Hours slept", "data": hours}],
        "quality": quality,
        "average_hours_7d": round(sum(last_week) / len(last_week), 2) if last_week else None,
        "average_quality_7d": round(sum(last_week_q) / len(last_week_q), 1) if last_week_q else None,
        "nights_logged_7d": len(last_week),
        "recommended_hours": [low, high],
    }


@router.get("/weekly-summary", response_model=WeeklySummary)
def read_weekly_summary(
    profile: CurrentProfile,
    session: SessionDep,
    tz_offset: TzOffset = 0,
    week: date | None = Query(default=None, description="Any day in the week; default this week"),
):
    """One week (Monday to Sunday) compared with the week before: workouts against the plan, lifts,
    records, sleep, weight and points."""
    today = local_today(tz_offset)
    monday = week_start(week or today)
    if monday > today:
        raise HTTPException(status_code=422, detail="That week hasn't started yet")
    return weekly_summary(session, profile, today, monday, tz_offset)
