from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Field, SQLModel, select

from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.user import (
    MarketingUpdate,
    Profile,
    ProfileIn,
    ProfilePublic,
    UserPublic,
    WeightEntry,
    WeightEntryIn,
    WeightEntryPublic,
)
from app.services import calculations as calc
from app.services.accounts import delete_user
from app.services.activity import (
    TzOffset,
    completed_workouts,
    local_date,
    local_today,
    sleep_goal,
    sleep_nights,
    user_routine,
)
from app.services.plan import PlanOut, build_plan
from app.services.recommendations import (
    DISCLAIMER,
    PROGRESSION_LOOKBACK_DAYS,
    Context,
    Recommendation,
    recommend,
)
from app.services.routine import Routine
from app.services.schedule import (
    DayChoice,
    effective_training_days,
    format_day_choices,
    format_days,
    parse_day_choices,
    validate_day_choices,
    validate_days,
)
from app.services.units import to_cm, to_kg

router = APIRouter(prefix="/me", tags=["me"])


def profile_public(profile: Profile) -> ProfilePublic:
    return ProfilePublic.model_validate(
        profile,
        update={
            "age": calc.age_on(profile.birth_date),
            "training_days": effective_training_days(profile),
            "training_days_chosen": profile.training_days is not None,
        },
    )


@router.get("", response_model=UserPublic)
def read_me(user: CurrentUser, session: SessionDep):
    return UserPublic.model_validate(user, update={"has_profile": session.get(Profile, user.id) is not None})


@router.delete("", status_code=204)
def delete_account(user: CurrentUser, session: SessionDep):
    """Delete the account and every piece of data that belongs to it."""
    delete_user(session, user)


@router.get("/profile", response_model=ProfilePublic)
def read_profile(profile: CurrentProfile):
    return profile_public(profile)


@router.put("/profile", response_model=ProfilePublic)
def save_profile(data: ProfileIn, user: CurrentUser, session: SessionDep):
    if data.birth_date >= date.today():
        raise HTTPException(status_code=422, detail="Birth date must be in the past")
    if not 13 <= calc.age_on(data.birth_date) <= 100:
        raise HTTPException(status_code=422, detail="Age must be between 13 and 100")
    values = data.model_dump(exclude={"height", "height_unit", "weight", "weight_unit", "training_days"})
    height_cm = to_cm(data.height, data.height_unit)
    weight_kg = to_kg(data.weight, data.weight_unit)
    if not 100 <= height_cm <= 250:
        raise HTTPException(status_code=422, detail="Height must be between 100 and 250 cm")
    if not 30 <= weight_kg <= 350:
        raise HTTPException(status_code=422, detail="Weight must be between 30 and 350 kg")

    profile = session.get(Profile, user.id)
    if data.training_days is not None:
        try:
            days = validate_days(data.training_days)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        values["training_days"] = format_days(days)
        values["days_per_week"] = len(days)
        if profile is not None:  # keep the user's own session types and names for the days still in the plan
            kept = {d: c for d, c in parse_day_choices(profile.day_plan).items() if d in days}
            values["day_plan"] = format_day_choices(kept)
    elif profile is not None and profile.training_days and data.days_per_week == profile.days_per_week:
        pass  # an older client that only knows the count: keep the days the user chose
    else:
        values["training_days"] = None  # count only: shown as "set automatically" until the user picks days
    weight_changed = profile is None or abs(profile.weight_kg - weight_kg) > 1e-6
    if profile is None:
        profile = Profile(user_id=user.id, height_cm=height_cm, weight_kg=weight_kg, **values)
    else:
        profile.sqlmodel_update({**values, "height_cm": height_cm, "weight_kg": weight_kg})
    session.add(profile)
    if weight_changed:
        _upsert_weigh_in(session, user.id, date.today(), weight_kg)
    session.commit()
    session.refresh(profile)
    return profile_public(profile)


def _upsert_weigh_in(session, user_id: int, day: date, weight_kg: float) -> WeightEntry:
    """One weigh-in per day: a second one on the same day replaces the first."""
    entry = session.exec(
        select(WeightEntry).where(WeightEntry.user_id == user_id, WeightEntry.date == day)
    ).first()
    if entry is None:
        entry = WeightEntry(user_id=user_id, date=day, weight_kg=weight_kg)
    else:
        entry.weight_kg = weight_kg
    session.add(entry)
    return entry


@router.post("/weight", response_model=WeightEntryPublic, status_code=201)
def log_weight(data: WeightEntryIn, profile: CurrentProfile, session: SessionDep):
    day = data.date or date.today()
    weight_kg = round(to_kg(data.weight, data.unit), 2)
    entry = _upsert_weigh_in(session, profile.user_id, day, weight_kg)
    latest = session.exec(
        select(WeightEntry)
        .where(WeightEntry.user_id == profile.user_id, WeightEntry.date > day)
        .limit(1)
    ).first()
    if latest is None:  # this is the newest weigh-in, so it becomes the current weight
        profile.weight_kg = weight_kg
        session.add(profile)
    session.commit()
    session.refresh(entry)
    return entry


@router.get("/weight", response_model=list[WeightEntryPublic])
def list_weight(user: CurrentUser, session: SessionDep, limit: int = Query(default=365, le=2000)):
    return session.exec(
        select(WeightEntry).where(WeightEntry.user_id == user.id).order_by(WeightEntry.date.desc()).limit(limit)
    ).all()


@router.delete("/weight/{entry_id}", status_code=204)
def delete_weight(entry_id: int, user: CurrentUser, session: SessionDep):
    entry = session.get(WeightEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Weigh-in not found")
    session.delete(entry)
    session.commit()


@router.put("/marketing", response_model=UserPublic)
def update_marketing(data: MarketingUpdate, user: CurrentUser, session: SessionDep):
    user.marketing_opt_in = data.opt_in
    user.marketing_consented_at = datetime.now(UTC) if data.opt_in else None
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserPublic.model_validate(user, update={"has_profile": session.get(Profile, user.id) is not None})


# ---------- Health plan ----------

@router.get("/plan", response_model=PlanOut)
def read_plan(profile: CurrentProfile):
    return build_plan(profile)


@router.get("/plan/projection")
def read_projection(profile: CurrentProfile):
    """Week-by-week projected weight for each diet option."""
    plan = build_plan(profile)
    age = plan.age
    series = []
    for opt in plan.options:
        if opt.option == "maintain":
            continue
        weights, reached = calc.project_weight(
            profile.weight_kg, opt.calories, profile.height_cm, age, profile.sex,
            profile.activity_level, plan.optimal_weight_kg,
        )
        series.append({
            "name": opt.option,
            "calories": opt.calories,
            "data": weights,
            "reaches_target_week": reached,
            "final_weight_kg": weights[-1],
        })
    length = max((len(s["data"]) for s in series), default=1)
    return {
        "labels": list(range(length)),
        "series": series,
        "target_weight_kg": plan.optimal_weight_kg,
        "note": "Eating the same calories every day: weight change slows as you get closer to your goal "
                "because a lighter body burns less. Recalculate your plan every few weeks.",
    }


@router.get("/routine", response_model=Routine)
def read_routine(profile: CurrentProfile, session: SessionDep):
    return user_routine(session, profile)


class ScheduleDayIn(SQLModel):
    weekday: int = Field(ge=0, le=6)  # 0 = Monday
    focus: str | None = None  # None: the recommended session for this day
    name: str | None = Field(default=None, max_length=200)  # None or empty: named after the session type


class ScheduleIn(SQLModel):
    days: list[ScheduleDayIn]


def _apply_schedule(data: ScheduleIn, profile: Profile) -> None:
    """Put the chosen days, session types and names on the profile (not saved), or raise 422."""
    try:
        days = validate_days([d.weekday for d in data.days])
        choices = validate_day_choices({d.weekday: DayChoice(d.focus, d.name) for d in data.days}, days)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    profile.training_days = format_days(days)
    profile.days_per_week = len(days)
    profile.day_plan = format_day_choices(choices)


@router.post("/schedule/preview", response_model=Routine)
def preview_schedule(data: ScheduleIn, profile: CurrentProfile, session: SessionDep):
    """The routine these choices would give, without saving them (for the schedule editor)."""
    draft = Profile.model_validate(profile.model_dump())  # a copy outside the database session
    _apply_schedule(data, draft)
    return user_routine(session, draft)


@router.put("/schedule", response_model=Routine)
def save_schedule(data: ScheduleIn, profile: CurrentProfile, session: SessionDep):
    """Save the training days with an optional session type and name for each. Logged workouts aren't touched."""
    _apply_schedule(data, profile)
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return user_routine(session, profile)


@router.delete("/schedule/custom", response_model=Routine)
def reset_schedule(profile: CurrentProfile, session: SessionDep):
    """Go back to the recommended session for every day (the days themselves stay)."""
    profile.day_plan = None
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return user_routine(session, profile)


class SleepGoalIn(SQLModel):
    minutes: int | None = Field(default=None, ge=4 * 60, le=12 * 60)  # None: the amount recommended for your age


class SleepGoalOut(SQLModel):
    goal_minutes: int
    goal_custom: bool
    recommended_hours: tuple[int, int]


@router.put("/sleep-goal", response_model=SleepGoalOut)
def save_sleep_goal(data: SleepGoalIn, profile: CurrentProfile, session: SessionDep):
    profile.sleep_goal_minutes = data.minutes
    session.add(profile)
    session.commit()
    goal = sleep_goal(profile)
    return SleepGoalOut(goal_minutes=goal.minutes, goal_custom=goal.custom, recommended_hours=goal.recommended_hours)


class RecommendationsOut(SQLModel):
    date: date
    items: list[Recommendation]
    disclaimer: str


@router.get("/recommendations", response_model=RecommendationsOut)
def read_recommendations(user: CurrentUser, profile: CurrentProfile, session: SessionDep, tz_offset: TzOffset = None):
    """Today's suggestions from the plan, last night's sleep, WHOOP recovery and recent workouts."""
    today = local_today(tz_offset)
    monday = today - timedelta(days=today.weekday())
    start = min(monday, today - timedelta(days=PROGRESSION_LOOKBACK_DAYS))
    ctx = Context(
        today=today,
        routine=user_routine(session, profile),
        sleep_goal=sleep_goal(profile),
        last_night=sleep_nights(session, profile.user_id, today, today).get(today),
        workouts=completed_workouts(session, profile.user_id, start, today, tz_offset),
        imperial=profile.unit_system == "imperial",
        since=local_date(user.created_at, tz_offset),
    )
    return RecommendationsOut(date=today, items=recommend(ctx), disclaimer=DISCLAIMER)
