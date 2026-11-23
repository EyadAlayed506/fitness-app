"""Phone health data beyond sleep: daily steps, and when each source last synced (HEALTH-02/03).

Contract: docs/team/HEALTH.md. The phone asks Health Connect / Apple Health for each day's total (both remove
duplicates between apps), so the server stores one number per day per source and never adds sources up.
"""

import datetime as dt
from enum import StrEnum

from pydantic import field_validator, model_validator
from sqlmodel import Field, SQLModel, UniqueConstraint

from app.models.user import utcnow

MAX_STEPS_PER_DAY = 200_000  # far above any real day; catches a unit or summing mistake on the phone


class PhoneSource(StrEnum):
    """Health stores on the phone. WHOOP is not one: it syncs server to server and has no steps."""

    health_connect = "health_connect"
    apple_health = "apple_health"


class DailySteps(SQLModel, table=True):
    """The step total of one local day, as one source reported it. A day with no data has no row."""

    __table_args__ = (UniqueConstraint("user_id", "date", "source"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    date: dt.date = Field(index=True)  # the phone's local day (midnight to midnight)
    steps: int
    source: PhoneSource
    tz_offset_seconds: int = 0  # the phone's offset when it counted the day
    synced_at: dt.datetime = Field(default_factory=utcnow)


class HealthSync(SQLModel, table=True):
    """When a phone source last sent data for this user, so screens and the coach can show "source + last sync".

    WHOOP's own last sync stays on WhoopConnection.
    """

    user_id: int = Field(foreign_key="user.id", primary_key=True)
    source: PhoneSource = Field(primary_key=True)
    last_sync_at: dt.datetime = Field(default_factory=utcnow)


class StepsDayIn(SQLModel):
    date: dt.date
    steps: int = Field(ge=0, le=MAX_STEPS_PER_DAY)

    @field_validator("date")
    @classmethod
    def not_in_future(cls, value: dt.date) -> dt.date:
        # one day of slack: a phone east of the server can already be on tomorrow
        if value > dt.datetime.now(dt.UTC).date() + dt.timedelta(days=1):
            raise ValueError("Steps can't be for a future day")
        return value


class StepsUpload(SQLModel):
    source: PhoneSource
    tz_offset_seconds: int = Field(default=0, ge=-18 * 3600, le=18 * 3600)
    days: list[StepsDayIn] = Field(max_length=400)

    @model_validator(mode="after")
    def one_value_per_day(self):
        dates = [d.date for d in self.days]
        if len(dates) != len(set(dates)):
            raise ValueError("Each day can be sent only once per request")
        return self


class StepsUploadResult(SQLModel):
    inserted: int = 0
    updated: int = 0


class StepsDay(SQLModel):
    date: dt.date
    steps: int | None  # null: no data for that day (never 0 as a stand-in)
    source: PhoneSource | None


class StepsHistory(SQLModel):
    days: list[StepsDay]


class Connector(SQLModel):
    source: str  # health_connect | apple_health | whoop
    metrics: list[str]
    last_sync_at: dt.datetime | None
    # WHOOP only: the server holds the login. Phone sources' permission lives on the phone.
    configured: bool | None = None
    connected: bool | None = None


class Connectors(SQLModel):
    connectors: list[Connector]
