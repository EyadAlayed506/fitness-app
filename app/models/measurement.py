import datetime as dt

from sqlmodel import Field, SQLModel

from app.models.user import LengthUnit

MEASUREMENT_FIELDS = [
    "waist_cm", "shoulders_cm", "chest_cm", "hips_cm", "neck_cm", "arm_cm", "thigh_cm",
]


class MeasurementValues(SQLModel):
    waist_cm: float | None = Field(default=None, gt=0)
    shoulders_cm: float | None = Field(default=None, gt=0)
    chest_cm: float | None = Field(default=None, gt=0)
    hips_cm: float | None = Field(default=None, gt=0)
    neck_cm: float | None = Field(default=None, gt=0)
    arm_cm: float | None = Field(default=None, gt=0)
    thigh_cm: float | None = Field(default=None, gt=0)


class BodyMeasurement(MeasurementValues, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    date: dt.date
    body_fat_pct: float | None = None


class BodyMeasurementIn(MeasurementValues):
    date: dt.date | None = None
    unit: LengthUnit = LengthUnit.cm  # unit of the values sent; stored in cm


class BodyMeasurementPublic(MeasurementValues):
    id: int
    date: dt.date
    body_fat_pct: float | None
