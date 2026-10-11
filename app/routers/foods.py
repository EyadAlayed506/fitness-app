import asyncio
from collections.abc import AsyncIterator
from datetime import date
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, or_, select

from app.database import SessionDep
from app.deps import CurrentUser
from app.models.food import (
    NUTRIENT_FIELDS,
    DayTotals,
    Food,
    FoodAddedVia,
    FoodCandidate,
    FoodCreate,
    FoodDay,
    FoodLog,
    FoodLogIn,
    FoodLogPublic,
    FoodLogUpdate,
    FoodPublic,
    FoodSearchResult,
    FoodSource,
)
from app.models.user import Profile, User
from app.services import food_search
from app.services.plan import build_plan
from app.services.units import UnitError, to_base_amount, units_for

router = APIRouter(tags=["food"])


async def get_http_client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as client:
        yield client


HttpClient = Annotated[httpx.AsyncClient, Depends(get_http_client)]


def _visible_foods(user: User):
    """Global foods plus the user's own custom foods."""
    return select(Food).where(or_(Food.owner_id.is_(None), Food.owner_id == user.id))


def _get_visible_food(session: Session, food_id: int, user: User) -> Food:
    food = session.get(Food, food_id)
    if food is None or (food.owner_id is not None and food.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Food not found")
    return food


# ---------- Foods ----------

@router.get("/foods/search", response_model=FoodSearchResult)
async def search_foods(
    user: CurrentUser,
    session: SessionDep,
    client: HttpClient,
    q: str = Query(min_length=1),
    online: bool = True,
):
    """Local foods first (built-in, imported, your own), then USDA and Open Food Facts."""
    local = food_search.search_local(list(session.exec(_visible_foods(user)).all()), q)
    result = FoodSearchResult(local=local, online=[])
    if not online:
        return result

    known = {(f.source, f.external_id) for f in local if f.external_id}
    sources = [("USDA FoodData Central", food_search.search_usda), ("Open Food Facts", food_search.search_off)]
    responses = await asyncio.gather(*(fn(client, q) for _, fn in sources), return_exceptions=True)
    for (label, _), res in zip(sources, responses):
        if isinstance(res, Exception):
            result.warnings.append(f"{label} is not reachable right now")
            continue
        result.online.extend(c for c in res if (c.source, c.external_id) not in known)
    return result


@router.post("/foods/import", response_model=FoodPublic)
def import_food(candidate: FoodCandidate, _: CurrentUser, session: SessionDep):
    """Save an online search result into the local database (or return it if already saved)."""
    if candidate.source not in (FoodSource.usda, FoodSource.off):
        raise HTTPException(status_code=422, detail="Only USDA or Open Food Facts results can be imported")
    existing = session.exec(
        select(Food).where(Food.source == candidate.source, Food.external_id == candidate.external_id)
    ).first()
    if existing:
        return existing
    food = Food.model_validate(candidate)
    session.add(food)
    session.commit()
    session.refresh(food)
    return food


@router.post("/foods", response_model=FoodPublic, status_code=201)
def create_food(data: FoodCreate, user: CurrentUser, session: SessionDep):
    """Manual custom food. Values can be per serving (as printed on a label) or per 100 g / 100 ml."""
    try:
        serving_base = to_base_amount(data.serving_size, data.serving_unit, data.is_liquid)
    except UnitError as e:
        raise HTTPException(status_code=422, detail=str(e))
    factor = 100 / serving_base if data.values_per == "serving" else 1
    nutrients = {
        k: (round(v * factor, 2) if v is not None else None)
        for k, v in data.model_dump(include=set(NUTRIENT_FIELDS)).items()
    }
    food = Food(
        name=data.name.strip(),
        brand=data.brand.strip(),
        is_liquid=data.is_liquid,
        serving_size=data.serving_size,
        serving_unit=data.serving_unit,
        owner_id=user.id,
        source=FoodSource.manual,
        **nutrients,
    )
    session.add(food)
    session.commit()
    session.refresh(food)
    return food


@router.get("/foods/mine", response_model=list[FoodPublic])
def my_foods(user: CurrentUser, session: SessionDep):
    return session.exec(select(Food).where(Food.owner_id == user.id).order_by(Food.name)).all()


@router.get("/foods/{food_id}", response_model=FoodPublic)
def read_food(food_id: int, user: CurrentUser, session: SessionDep):
    return _get_visible_food(session, food_id, user)


@router.get("/foods/{food_id}/units", response_model=list[str])
def food_units(food_id: int, user: CurrentUser, session: SessionDep):
    """Units this food can be logged in: g/kg/oz/lb for solids, ml/l/cup/gallon... for liquids."""
    food = _get_visible_food(session, food_id, user)
    return units_for(food.is_liquid, bool(food.serving_size and food.serving_unit))


@router.delete("/foods/{food_id}", status_code=204)
def delete_food(food_id: int, user: CurrentUser, session: SessionDep):
    food = session.get(Food, food_id)
    if food is None or food.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Food not found")
    if session.exec(select(FoodLog).where(FoodLog.food_id == food.id).limit(1)).first():
        raise HTTPException(status_code=409, detail="This food is used in your food log")
    session.delete(food)
    session.commit()


# ---------- Food log ----------

def _compute_entry(food: Food, quantity: float, unit: str) -> dict:
    try:
        amount = to_base_amount(quantity, unit, food.is_liquid, food.serving_size, food.serving_unit)
    except UnitError as e:
        raise HTTPException(status_code=422, detail=str(e))
    f = amount / 100
    return {
        "quantity": quantity,
        "unit": unit,
        "amount_base": round(amount, 1),
        "calories": round(food.calories * f, 1),
        "protein_g": round(food.protein_g * f, 1),
        "carbs_g": round(food.carbs_g * f, 1),
        "fat_g": round(food.fat_g * f, 1),
    }


def _log_public(entry: FoodLog, food_name: str) -> FoodLogPublic:
    return FoodLogPublic.model_validate(entry, update={"food_name": food_name})


def _get_owned_log(session: Session, log_id: int, user: User) -> FoodLog:
    entry = session.get(FoodLog, log_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return entry


@router.post("/food-logs", response_model=FoodLogPublic, status_code=201)
def log_food(data: FoodLogIn, user: CurrentUser, session: SessionDep):
    food = _get_visible_food(session, data.food_id, user)
    entry = FoodLog(
        user_id=user.id,
        food_id=food.id,
        date=data.date or date.today(),
        meal=data.meal,
        added_via=data.added_via if food.source != FoodSource.manual else FoodAddedVia.manual,
        **_compute_entry(food, data.quantity, data.unit),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _log_public(entry, food.name)


@router.get("/food-logs", response_model=FoodDay)
def food_day(user: CurrentUser, session: SessionDep, day: date | None = Query(default=None, alias="date")):
    day = day or date.today()
    rows = session.exec(
        select(FoodLog, Food.name)
        .join(Food, Food.id == FoodLog.food_id)
        .where(FoodLog.user_id == user.id, FoodLog.date == day)
        .order_by(FoodLog.created_at)
    ).all()
    entries = [_log_public(e, name) for e, name in rows]
    totals = DayTotals(
        calories=round(sum(e.calories for e in entries), 1),
        protein_g=round(sum(e.protein_g for e in entries), 1),
        carbs_g=round(sum(e.carbs_g for e in entries), 1),
        fat_g=round(sum(e.fat_g for e in entries), 1),
    )
    profile = session.get(Profile, user.id)
    target = build_plan(profile).target_calories if profile else None
    return FoodDay(date=day, entries=entries, totals=totals, target_calories=target)


@router.patch("/food-logs/{log_id}", response_model=FoodLogPublic)
def update_food_log(log_id: int, data: FoodLogUpdate, user: CurrentUser, session: SessionDep):
    entry = _get_owned_log(session, log_id, user)
    food = session.get(Food, entry.food_id)
    if data.meal is not None:
        entry.meal = data.meal
    if data.quantity is not None or data.unit is not None:
        entry.sqlmodel_update(
            _compute_entry(food, data.quantity or entry.quantity, data.unit or entry.unit)
        )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _log_public(entry, food.name)


@router.delete("/food-logs/{log_id}", status_code=204)
def delete_food_log(log_id: int, user: CurrentUser, session: SessionDep):
    session.delete(_get_owned_log(session, log_id, user))
    session.commit()
