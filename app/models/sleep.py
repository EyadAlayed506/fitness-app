import datetime as dt
from enum import StrEnum

from pydantic import AwareDatetime, NaiveDatetime, field_validator, model_validator
from sqlmodel import Field, SQLModel

from app.models.user import utcnow

MAX_SLEEP_HOURS = 20


class SleepSource(StrEnum):
    manual = "manual"
    whoop = "whoop"
    health_connect = "health_connect"  # Android Health Connect, sent by the phone app
    # Planned (see ARCHITECTURE.md): apple_health


SOURCE_NAMES = {SleepSource.manual: "you", SleepSource.whoop: "WHOOP", SleepSource.health_connect: "Health Connect"}


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
    # Filled in by trackers (WHOOP, Health Connect)
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


class HealthConnectStage(SQLModel):
    start_time: AwareDatetime
    end_time: AwareDatetime
    stage: int  # Health Connect's SleepStageType: 1 awake, 2 sleeping, 3 out of bed, 4 light, 5 deep, 6 REM


class HealthConnectSession(SQLModel):
    """One SleepSessionRecord as the phone app reads it from Health Connect."""

    id: str = Field(min_length=1, max_length=100)  # Health Connect's record id
    start_time: AwareDatetime
    end_time: AwareDatetime
    # Time zone the sleep was recorded in; the phone sends its own when Health Connect has none
    zone_offset_seconds: int = Field(default=0, ge=-18 * 3600, le=18 * 3600)
    stages: list[HealthConnectStage] = Field(default_factory=list, max_length=500)
    app: str = Field(default="", max_length=200)  # the app that wrote it, e.g. com.sec.android.app.shealth


class HealthConnectImport(SQLModel):
    sessions: list[HealthConnectSession] = Field(max_length=400)


class HealthConnectImportResult(SQLModel):
    imported: int = 0
    updated: int = 0
    replaced_manual: int = 0
    skipped: int = 0  # unusable, or the night is already in the log from WHOOP or another app
