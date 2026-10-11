from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import select

from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.exercise import Exercise
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
from app.services.plan import PlanOut, build_plan
from app.services.routine import Routine, generate_routine
from app.services.units import to_cm, to_kg

router = APIRouter(prefix="/me", tags=["me"])


def profile_public(profile: Profile) -> ProfilePublic:
    return ProfilePublic.model_validate(profile, update={"age": calc.age_on(profile.birth_date)})


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
    values = data.model_dump(exclude={"height", "height_unit", "weight", "weight_unit"})
    height_cm = to_cm(data.height, data.height_unit)
    weight_kg = to_kg(data.weight, data.weight_unit)
    if not 100 <= height_cm <= 250:
        raise HTTPException(status_code=422, detail="Height must be between 100 and 250 cm")
    if not 30 <= weight_kg <= 350:
        raise HTTPException(status_code=422, detail="Weight must be between 30 and 350 kg")

    profile = session.get(Profile, user.id)
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
    plan = build_plan(profile)
    catalogue = list(session.exec(select(Exercise)).all())
    return generate_routine(
        catalogue, profile.days_per_week, profile.minutes_per_session, profile.equipment, plan.direction
    )
