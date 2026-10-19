"""Android Health Connect: turning the sleep sessions the phone app reads into sleep entries.

Health Connect lives on the phone, so there is no login or token here: the phone asks the user for
permission, reads the sessions and sends them to POST /api/sleep/health-connect.
"""

import datetime as dt

from sqlmodel import Session, select

from app.models.sleep import (
    MAX_SLEEP_HOURS,
    HealthConnectImportResult,
    HealthConnectSession,
    SleepEntry,
    SleepSource,
)

# Health Connect's SleepStageType
AWAKE = {1, 3}  # awake, out of bed
LIGHT, DEEP, REM = 4, 5, 6
# 0 (unknown) and 2 (sleeping) count as asleep, without a stage


def _local(t: dt.datetime, offset: dt.timedelta) -> dt.datetime:
    """UTC time -> the clock time where the user slept (no timezone, like manual entries)."""
    return (t.astimezone(dt.UTC) + offset).replace(tzinfo=None, second=0, microsecond=0)


def entry_fields(s: HealthConnectSession) -> dict | None:
    """Map one Health Connect sleep session to SleepEntry fields. None if it can't be used."""
    offset = dt.timedelta(seconds=s.zone_offset_seconds)
    bedtime = _local(s.start_time, offset)
    wake = _local(s.end_time, offset)
    in_bed = round((wake - bedtime).total_seconds() / 60)
    if in_bed <= 0 or in_bed > MAX_SLEEP_HOURS * 60:
        return None
    fields: dict = {
        "bedtime": bedtime, "wake_time": wake, "date": wake.date(), "duration_minutes": in_bed,
        "light_minutes": None, "deep_minutes": None, "rem_minutes": None, "awake_minutes": None,
    }
    seconds = {"light": 0.0, "deep": 0.0, "rem": 0.0, "awake": 0.0, "asleep": 0.0}
    for stage in s.stages:
        length = max(0.0, (stage.end_time - stage.start_time).total_seconds())
        kind = {LIGHT: "light", DEEP: "deep", REM: "rem"}.get(stage.stage, "awake" if stage.stage in AWAKE else "asleep")
        seconds[kind] += length
    minutes = {k: round(v / 60) for k, v in seconds.items()}
    asleep = minutes["light"] + minutes["deep"] + minutes["rem"] + minutes["asleep"]
    if s.stages and asleep:
        fields["duration_minutes"] = min(asleep, in_bed)
    # Stages only when the tracker measured them (light / deep / REM), never just "sleeping"
    if minutes["light"] + minutes["deep"] + minutes["rem"]:
        fields.update(
            light_minutes=minutes["light"], deep_minutes=minutes["deep"], rem_minutes=minutes["rem"],
            awake_minutes=minutes["awake"],
        )
    return fields


def import_sessions(session: Session, user_id: int, sessions: list[HealthConnectSession]) -> HealthConnectImportResult:
    """Add or update the sessions. Like WHOOP, they replace nights typed in by hand.

    A session that overlaps a night already imported (from WHOOP, or another app writing to Health
    Connect for the same night) is skipped, so a night is never counted twice.
    """
    result = HealthConnectImportResult()
    # Sessions with stages first: when two apps wrote the same night, the more detailed one is kept
    for s in sorted(sessions, key=lambda s: (not s.stages, s.start_time - s.end_time)):
        fields = entry_fields(s)
        if fields is None:
            result.skipped += 1
            continue
        entry = session.exec(
            select(SleepEntry).where(
                SleepEntry.user_id == user_id,
                SleepEntry.source == SleepSource.health_connect,
                SleepEntry.external_id == s.id,
            )
        ).first()
        clash = select(SleepEntry).where(
            SleepEntry.user_id == user_id,
            SleepEntry.source != SleepSource.manual,
            SleepEntry.bedtime < fields["wake_time"],
            SleepEntry.wake_time > fields["bedtime"],
        )
        if entry is not None:
            clash = clash.where(SleepEntry.id != entry.id)
        if session.exec(clash).first() is not None:
            result.skipped += 1
            continue
        if entry is None:
            entry = SleepEntry(user_id=user_id, source=SleepSource.health_connect, external_id=s.id, **fields)
            result.imported += 1
        else:
            entry.sqlmodel_update(fields)  # the user's quality and notes stay
            result.updated += 1
        for manual in session.exec(
            select(SleepEntry).where(
                SleepEntry.user_id == user_id,
                SleepEntry.source == SleepSource.manual,
                SleepEntry.bedtime < fields["wake_time"],
                SleepEntry.wake_time > fields["bedtime"],
            )
        ).all():
            session.delete(manual)
            result.replaced_manual += 1
        session.add(entry)
        session.flush()  # later sessions in this batch see this one
    session.commit()
    return result
