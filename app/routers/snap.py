"""Snap and say: screenshot to routine, snap the weight, the menu scanner, and personal insights."""

from datetime import date

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlmodel import SQLModel, func, select

from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.exercise import Exercise, ExercisePublic
from app.models.food import Food, FoodAddedVia, FoodLog, FoodLogPublic, FoodSource
from app.models.snap import MenuDish, MenuLogIn, MenuOut, ScreenshotItem, ScreenshotRoutineOut, WeightReading
from app.routers.exercises import MAX_PHOTO_BYTES
from app.routers.foods import _compute_entry, _log_public
from app.routers.gyms import RecognizerDep
from app.services import insights, snap
from app.services.activity import TzOffset, local_today, user_routine
from app.services.plan import build_plan
from app.services.recognition import Recognizer, RecognitionError, image_type

router = APIRouter(tags=["snap and say"])


def _photo(image: UploadFile) -> bytes:
    data = image.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The picture is too big. Try a smaller one.")
    if image_type(data) is None:
        raise HTTPException(status_code=415, detail="That isn't a picture the app can read (use JPEG, PNG or WebP).")
    return data


def _ready(recognizer: Recognizer) -> None:
    problem = recognizer.problem()
    if problem:
        raise HTTPException(status_code=503, detail=problem)


@router.post("/snap/workout-screenshot", response_model=ScreenshotRoutineOut)
def workout_screenshot(
    user: CurrentUser, profile: CurrentProfile, session: SessionDep, recognizer: RecognizerDep, image: UploadFile = File(...)
):
    """The exercises, sets and reps in a workout screenshot, each matched to the catalogue (or left for the user)."""
    data = _photo(image)
    _ready(recognizer)
    catalogue = list(session.exec(select(Exercise).order_by(Exercise.id)).all())
    default_reps = user_routine(session, profile).reps
    try:
        title, items = snap.read_screenshot(recognizer, data, catalogue, default_reps)
    except RecognitionError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    return ScreenshotRoutineOut(
        title=title,
        items=[
            ScreenshotItem(
                text=i["text"],
                exercise=ExercisePublic.model_validate(i["exercise"]) if i["exercise"] else None,
                sets=i["sets"],
                reps=i["reps"],
                confidence=i["confidence"],
            )
            for i in items
        ],
        model=recognizer.model,
    )


@router.post("/snap/weight", response_model=WeightReading)
def snap_weight(_: CurrentUser, recognizer: RecognizerDep, image: UploadFile = File(...)):
    """The weight on a pin stack, a loaded bar or a dumbbell. The app asks the user to confirm it."""
    data = _photo(image)
    _ready(recognizer)
    try:
        reading = snap.read_weight(recognizer, data)
    except RecognitionError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    return WeightReading(**reading, model=recognizer.model)


def _remaining_today(session, user_id: int, profile, day: date) -> tuple[float, float, float]:
    """Calories and protein left today, and the day's calorie target."""
    target = build_plan(profile).target_calories
    kcal, protein = session.exec(
        select(func.coalesce(func.sum(FoodLog.calories), 0), func.coalesce(func.sum(FoodLog.protein_g), 0))
        .where(FoodLog.user_id == user_id, FoodLog.date == day)
    ).one()
    protein_target = target * 0.3 / 4  # the same 30% the app's macro bars use
    return target - kcal, max(0.0, protein_target - protein), target


@router.post("/snap/menu", response_model=MenuOut)
def scan_menu(
    user: CurrentUser,
    profile: CurrentProfile,
    session: SessionDep,
    recognizer: RecognizerDep,
    image: UploadFile = File(...),
    tz_offset: TzOffset = None,
    day: date | None = Query(default=None, alias="date", description="The day to fit the dishes to (default: today)"),
):
    """Dishes on a menu with estimated calories and macros, best fit for what's left of the day first."""
    data = _photo(image)
    _ready(recognizer)
    try:
        dishes, seen = snap.read_menu(recognizer, data)
    except RecognitionError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    remaining, protein_left, target = _remaining_today(session, user.id, profile, day or local_today(tz_offset))
    ranked = snap.rank_dishes(dishes, remaining, protein_left, target)
    return MenuOut(
        dishes=[MenuDish(**d) for d in ranked],
        remaining_calories=round(remaining),
        remaining_protein_g=round(protein_left),
        seen=seen,
        model=recognizer.model,
        note="Calories and macros are the AI's estimates from the menu, not measured. Portions vary between restaurants.",
    )


MENU_PORTION_G = 350  # one portion, when the AI didn't estimate its weight


@router.post("/snap/menu/log", response_model=FoodLogPublic, status_code=201)
def log_menu_dish(data: MenuLogIn, user: CurrentUser, session: SessionDep, tz_offset: TzOffset = None):
    """Log a dish from the menu scanner: saved as the user's own food ("Menu estimate"); `servings` portions."""
    portion = data.portion_g or MENU_PORTION_G
    per_100 = 100 / portion
    food = Food(
        name=data.name.strip(),
        brand="Menu estimate",
        is_liquid=False,
        serving_size=portion,
        serving_unit="g",
        calories=round(data.calories * per_100, 2),
        protein_g=round(data.protein_g * per_100, 2),
        carbs_g=round(data.carbs_g * per_100, 2),
        fat_g=round(data.fat_g * per_100, 2),
        source=FoodSource.manual,
        owner_id=user.id,
    )
    session.add(food)
    session.commit()
    session.refresh(food)
    entry = FoodLog(
        user_id=user.id,
        food_id=food.id,
        date=data.date or local_today(tz_offset),
        meal=data.meal,
        added_via=FoodAddedVia.manual,
        **_compute_entry(food, data.servings, "serving"),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _log_public(entry, food.name)


# ---------- personal insights ----------

class InsightGroupOut(SQLModel):
    label: str
    n: int
    value: float
    unit: str


class InsightOut(SQLModel):
    id: str
    title: str
    text: str
    groups: list[InsightGroupOut]
    strength: str  # "clear", "could be chance" or "count"
    caution: str


class InsightsOut(SQLModel):
    insights: list[InsightOut]
    not_enough: list[str]  # findings that need more data, and how much
    note: str


@router.get("/analytics/insights", response_model=InsightsOut)
def personal_insights(user: CurrentUser, profile: CurrentProfile, session: SessionDep, tz_offset: TzOffset = None):
    """Patterns in the user's own data (sleep, training, food, weight), only where there's enough data."""
    result = insights.compute(session, user, profile, local_today(tz_offset), tz_offset)
    return InsightsOut(
        insights=[
            InsightOut(
                id=f.id, title=f.title, text=f.text, strength=f.strength, caution=f.caution,
                groups=[InsightGroupOut(**g.__dict__) for g in f.groups],
            )
            for f in result.findings
        ],
        not_enough=result.not_enough,
        note=insights.CAUTION,
    )

