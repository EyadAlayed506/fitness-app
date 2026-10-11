import datetime as dt
from enum import StrEnum

from pydantic import NaiveDatetime, field_validator, model_validator
from sqlmodel import Field, SQLModel

from app.models.user import utcnow

MAX_SLEEP_HOURS = 20


class SleepSource(StrEnum):
    manual = "manual"
    whoop = "whoop"
    # Planned (see ARCHITECTURE.md): health_connect, apple_health


class SleepEntry(SQLModel, table=True):
    """One sleep. Times are the user's local wall-clock times, stored without a timezone."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    date: dt.date = Field(index=True)  # the morning the user woke up
    bedtime: NaiveDatetime  # local clock time, no timezone
    wake_time: NaiveDatetime
    duration_minutes: int  # time asleep when a tracker reports it, otherwise bedtime to wake-up
    quality: int | None = None  # 1 (very poor) to 5 (great)
    notes: str = ""
    source: SleepSource = SleepSource.manual
    created_at: dt.datetime = Field(default_factory=utcnow)
    # Filled in by trackers (WHOOP)
    external_id: str | None = Field(default=None, index=True)
    light_minutes: int | None = None
    deep_minutes: int | None = None
    rem_minutes: int | None = None
    awake_minutes: int | None = None
    performance_pct: float | None = None  # WHOOP sleep performance
    recovery_score: float | None = None  # WHOOP recovery the next morning


def _wall_clock(value: dt.datetime | None) -> dt.datetime | None:
    # Keep the clock time the user entered; a timezone, if sent, is ignored
    return value.replace(tzinfo=None, second=0, microsecond=0) if value else value


def check_times(bedtime: dt.datetime, wake_time: dt.datetime) -> None:
    if wake_time <= bedtime:
        raise ValueError("Wake-up time must be after bedtime")
    if wake_time - bedtime > dt.timedelta(hours=MAX_SLEEP_HOURS):
        raise ValueError(f"A sleep can't be longer than {MAX_SLEEP_HOURS} hours. Check the dates")


class SleepEntryIn(SQLModel):
    bedtime: dt.datetime
    wake_time: dt.datetime
    quality: int | None = Field(default=None, ge=1, le=5)
    notes: str = Field(default="", max_length=500)

    _clock = field_validator("bedtime", "wake_time")(_wall_clock)

    @model_validator(mode="after")
    def valid_times(self):
        check_times(self.bedtime, self.wake_time)
        return self


class SleepEntryUpdate(SQLModel):
    bedtime: dt.datetime | None = None
    wake_time: dt.datetime | None = None
    quality: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = Field(default=None, max_length=500)

    _clock = field_validator("bedtime", "wake_time")(_wall_clock)


class SleepEntryPublic(SQLModel):
    id: int
    date: dt.date
    bedtime: NaiveDatetime
    wake_time: NaiveDatetime
    duration_minutes: int
    quality: int | None
    notes: str
    source: SleepSource
    light_minutes: int | None = None
    deep_minutes: int | None = None
    rem_minutes: int | None = None
    awake_minutes: int | None = None
    performance_pct: float | None = None
    recovery_score: float | None = None
