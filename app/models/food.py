import datetime as dt
from datetime import datetime
from enum import StrEnum
from typing import Literal

from sqlmodel import Field, SQLModel

from app.models.user import utcnow


class FoodSource(StrEnum):
    builtin = "builtin"  # small starter list shipped with the app
    usda = "usda"
    off = "off"  # Open Food Facts
    manual = "manual"


class Meal(StrEnum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class FoodAddedVia(StrEnum):
    search = "search"
    manual = "manual"


# Macros are required, sub-macros optional. Values are per 100 g (solids) or 100 ml (liquids).
class Nutrients(SQLModel):
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    fiber_g: float | None = Field(default=None, ge=0)
    sugar_g: float | None = Field(default=None, ge=0)
    added_sugar_g: float | None = Field(default=None, ge=0)
    saturated_fat_g: float | None = Field(default=None, ge=0)
    trans_fat_g: float | None = Field(default=None, ge=0)
    cholesterol_mg: float | None = Field(default=None, ge=0)
    sodium_mg: float | None = Field(default=None, ge=0)
    potassium_mg: float | None = Field(default=None, ge=0)


NUTRIENT_FIELDS = list(Nutrients.model_fields)


class FoodBase(Nutrients):
    name: str = Field(index=True, min_length=1)
    brand: str = ""
    is_liquid: bool = False
    serving_size: float | None = Field(default=None, gt=0)
    serving_unit: str | None = None  # g / ml / oz ... (same kind as is_liquid)


class Food(FoodBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    owner_id: int | None = Field(default=None, foreign_key="user.id", index=True)  # None = global
    source: FoodSource
    external_id: str | None = Field(default=None, index=True)


class FoodPublic(FoodBase):
    id: int
    source: FoodSource
    owner_id: int | None


class FoodCandidate(FoodBase):
    """A food found online, not saved yet. POST it to /api/foods/import to use it."""

    source: FoodSource
    external_id: str


class FoodCreate(Nutrients):
    """Manual custom food. Nutrient values are for one serving (as on a label) or per 100 g/ml."""

    name: str = Field(min_length=1)
    brand: str = ""
    is_liquid: bool = False
    serving_size: float = Field(gt=0)
    serving_unit: str = "g"
    values_per: Literal["serving", "100"] = "serving"


class FoodSearchResult(SQLModel):
    local: list[FoodPublic]
    online: list[FoodCandidate]
    warnings: list[str] = []


class FoodLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    food_id: int = Field(foreign_key="food.id", index=True)
    date: dt.date = Field(index=True)
    meal: Meal
    quantity: float
    unit: str
    amount_base: float  # grams or ml
    # snapshot so editing a food later does not rewrite history
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    added_via: FoodAddedVia = FoodAddedVia.search
    created_at: datetime = Field(default_factory=utcnow)


class FoodLogIn(SQLModel):
    food_id: int
    date: dt.date | None = None
    meal: Meal = Meal.snack
    quantity: float = Field(gt=0)
    unit: str = "g"
    added_via: FoodAddedVia = FoodAddedVia.search


class FoodLogUpdate(SQLModel):
    meal: Meal | None = None
    quantity: float | None = Field(default=None, gt=0)
    unit: str | None = None


class FoodLogPublic(SQLModel):
    id: int
    food_id: int
    food_name: str
    date: dt.date
    meal: Meal
    quantity: float
    unit: str
    amount_base: float
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class DayTotals(SQLModel):
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class FoodDay(SQLModel):
    date: dt.date
    entries: list[FoodLogPublic]
    totals: DayTotals
    target_calories: float | None
