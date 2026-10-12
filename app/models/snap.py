"""Snap and say: reading screenshots, weights and menus with the vision model, and the user's own exercise days."""

import datetime as dt

from sqlmodel import Field, SQLModel

from app.models.exercise import ExercisePublic
from app.models.food import Meal
from app.models.user import utcnow


# ---------- a plan day with the user's own exercises (e.g. from a screenshot) ----------

class CustomDay(SQLModel, table=True):
    """Exercises the user chose for one training day; used instead of the generated ones."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    weekday: int  # 0 = Monday
    title: str
    exercises: str  # JSON list of {"exercise_id", "sets", "reps"}
    created_at: dt.datetime = Field(default_factory=utcnow)


class CustomExerciseIn(SQLModel):
    exercise_id: int
    sets: int = Field(default=3, ge=1, le=10)
    reps: str = Field(default="8-12", min_length=1, max_length=12)


class CustomDayIn(SQLModel):
    title: str = Field(min_length=1, max_length=60)
    exercises: list[CustomExerciseIn] = Field(min_length=1, max_length=15)


# ---------- screenshot to routine ----------

class ScreenshotItem(SQLModel):
    text: str  # as written in the screenshot
    exercise: ExercisePublic | None  # the catalogue match; None when the user must pick one
    sets: int
    reps: str
    confidence: float


class ScreenshotRoutineOut(SQLModel):
    title: str
    items: list[ScreenshotItem]
    model: str


# ---------- snap the weight ----------

class WeightReading(SQLModel):
    kind: str  # pin_stack, barbell, dumbbell, other
    weight: float | None  # None when it couldn't be read
    unit: str | None  # kg or lb
    details: str  # what the model read, e.g. "pin at the plate marked 45"
    confidence: float
    model: str


# ---------- menu scanner ----------

class MenuDish(SQLModel):
    name: str
    description: str
    portion_g: float | None = None  # estimated weight of one portion (None: not given)
    calories: float  # estimates for one restaurant portion
    protein_g: float
    carbs_g: float
    fat_g: float
    fit: float  # 0 to 1: how well it fits what's left of today's plan
    verdict: str  # why, in a few words


class MenuOut(SQLModel):
    dishes: list[MenuDish]  # best fit first
    remaining_calories: float
    remaining_protein_g: float
    seen: str
    model: str
    note: str


class MenuLogIn(SQLModel):
    name: str = Field(min_length=1, max_length=120)
    calories: float = Field(ge=0, le=5000)
    protein_g: float = Field(ge=0, le=500)
    carbs_g: float = Field(ge=0, le=1000)
    fat_g: float = Field(ge=0, le=500)
    meal: Meal = Meal.lunch
    date: dt.date | None = None
    servings: float = Field(default=1, gt=0, le=5)  # portions eaten, e.g. 0.5 for half
    portion_g: float | None = Field(default=None, ge=20, le=2000)  # weight of one portion, if estimated
