import datetime as dt
import secrets
from datetime import UTC, date, datetime
from enum import StrEnum

from pydantic import EmailStr
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


class Sex(StrEnum):
    male = "male"
    female = "female"


class ActivityLevel(StrEnum):
    sedentary = "sedentary"
    light = "light"
    moderate = "moderate"
    active = "active"
    very_active = "very_active"


class Goal(StrEnum):
    auto = "auto"  # pick from BMI
    lose = "lose"
    maintain = "maintain"
    gain = "gain"


class DietOption(StrEnum):
    light = "light"
    normal = "normal"
    extreme = "extreme"


class Equipment(StrEnum):
    gym = "gym"
    home = "home"  # dumbbells + bodyweight
    bodyweight = "bodyweight"


class UnitSystem(StrEnum):
    metric = "metric"
    imperial = "imperial"


class WeightUnit(StrEnum):
    kg = "kg"
    lb = "lb"


class LengthUnit(StrEnum):
    cm = "cm"
    inch = "in"


# ---------- User ----------

class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    marketing_opt_in: bool = False
    marketing_consented_at: datetime | None = None
    unsubscribe_token: str = Field(default_factory=lambda: secrets.token_urlsafe(24), unique=True)
    created_at: datetime = Field(default_factory=utcnow)


class UserCreate(SQLModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    marketing_opt_in: bool = False


class UserPublic(SQLModel):
    id: int
    email: str
    marketing_opt_in: bool
    created_at: datetime
    has_profile: bool = False


class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


class MarketingUpdate(SQLModel):
    opt_in: bool


# ---------- Profile ----------

class ProfileBase(SQLModel):
    birth_date: date
    sex: Sex
    activity_level: ActivityLevel = ActivityLevel.moderate
    goal: Goal = Goal.auto
    diet_option: DietOption = DietOption.normal
    days_per_week: int = Field(default=3, ge=1, le=6)
    minutes_per_session: int = Field(default=45, ge=15, le=180)
    equipment: Equipment = Equipment.gym
    unit_system: UnitSystem = UnitSystem.metric


class Profile(ProfileBase, table=True):
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    height_cm: float
    weight_kg: float  # latest weigh-in


class ProfileIn(ProfileBase):
    height: float = Field(gt=0)
    height_unit: LengthUnit = LengthUnit.cm
    weight: float = Field(gt=0)
    weight_unit: WeightUnit = WeightUnit.kg


class ProfilePublic(ProfileBase):
    height_cm: float
    weight_kg: float
    age: int


# ---------- Weigh-ins ----------

class WeightEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    date: dt.date
    weight_kg: float


class WeightEntryIn(SQLModel):
    date: dt.date | None = None  # default: today
    weight: float = Field(gt=0)
    unit: WeightUnit = WeightUnit.kg


class WeightEntryPublic(SQLModel):
    id: int
    date: dt.date
    weight_kg: float
