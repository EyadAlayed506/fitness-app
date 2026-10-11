from datetime import UTC, datetime
from enum import StrEnum

from pydantic import field_validator
from sqlmodel import Field, SQLModel

from app.models.user import WeightUnit, utcnow


class AddedVia(StrEnum):
    name = "name"
    qr = "qr"


class WorkoutSession(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    started_at: datetime = Field(default_factory=utcnow)
    ended_at: datetime | None = None
    notes: str = ""


class WorkoutSessionIn(SQLModel):
    started_at: datetime | None = None
    notes: str = ""


class WorkoutSessionUpdate(SQLModel):
    ended_at: datetime | None = None
    notes: str | None = None
    finish: bool = False  # shortcut: set ended_at to now


class WorkoutSet(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="workoutsession.id", index=True)
    exercise_id: int = Field(foreign_key="exercise.id", index=True)
    set_number: int
    reps: int
    weight_kg: float = 0
    rpe: float | None = None
    rest_seconds: int | None = None
    notes: str = ""
    added_via: AddedVia = AddedVia.name


class WorkoutSetIn(SQLModel):
    exercise_id: int
    reps: int = Field(ge=0, le=1000)
    weight: float = Field(default=0, ge=0)
    unit: WeightUnit = WeightUnit.kg
    rpe: float | None = Field(default=None, ge=1, le=10)
    rest_seconds: int | None = Field(default=None, ge=0)
    notes: str = ""
    added_via: AddedVia = AddedVia.name


class WorkoutSetUpdate(SQLModel):
    reps: int | None = Field(default=None, ge=0, le=1000)
    weight: float | None = Field(default=None, ge=0)
    unit: WeightUnit = WeightUnit.kg
    rpe: float | None = Field(default=None, ge=1, le=10)
    rest_seconds: int | None = Field(default=None, ge=0)
    notes: str | None = None


class WorkoutSetPublic(SQLModel):
    id: int
    exercise_id: int
    exercise_name: str
    set_number: int
    reps: int
    weight_kg: float
    rpe: float | None
    rest_seconds: int | None
    notes: str
    added_via: AddedVia


class WorkoutSessionPublic(SQLModel):
    id: int
    started_at: datetime
    ended_at: datetime | None
    notes: str
    set_count: int = 0
    volume_kg: float = 0
    sets: list[WorkoutSetPublic] = []

    @field_validator("started_at", "ended_at")
    @classmethod
    def assume_utc(cls, value: datetime | None) -> datetime | None:
        # SQLite drops the timezone; times are stored in UTC
        return value.replace(tzinfo=UTC) if value and value.tzinfo is None else value
