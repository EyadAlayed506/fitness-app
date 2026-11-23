"""Daily steps from the phone and "source + last sync" for every health source (HEALTH-02/03)."""

import datetime as dt

from sqlmodel import Session, select

from app.models.health import (
    Connector,
    DailySteps,
    HealthSync,
    PhoneSource,
    StepsDay,
    StepsUpload,
    StepsUploadResult,
)
from app.models.user import utcnow
from app.models.whoop import WhoopConnection
from app.services import whoop

PHONE_METRICS = ["sleep", "steps"]
WHOOP_METRICS = ["sleep", "recovery"]


def record_sync(session: Session, user_id: int, source: PhoneSource) -> None:
    """Remember that this phone source just sent data (even an empty batch: it's still a sync). Caller commits."""
    row = session.get(HealthSync, (user_id, source))
    if row is None:
        row = HealthSync(user_id=user_id, source=source)
    row.last_sync_at = utcnow()
    session.add(row)


def save_steps(session: Session, user_id: int, data: StepsUpload) -> StepsUploadResult:
    """Each day replaces that day's earlier value from the same source. Days not sent are left alone."""
    result = StepsUploadResult()
    now = utcnow()
    existing = {
        row.date: row
        for row in session.exec(
            select(DailySteps).where(
                DailySteps.user_id == user_id,
                DailySteps.source == data.source,
                DailySteps.date.in_([d.date for d in data.days]),
            )
        ).all()
    } if data.days else {}
    for day in data.days:
        row = existing.get(day.date)
        if row is None:
            row = DailySteps(user_id=user_id, date=day.date, source=data.source, steps=day.steps)
            result.inserted += 1
        else:
            row.steps = day.steps
            result.updated += 1
        row.tz_offset_seconds = data.tz_offset_seconds
        row.synced_at = now
        session.add(row)
    record_sync(session, user_id, data.source)
    session.commit()
    return result


def _aware(t: dt.datetime | None) -> dt.datetime | None:
    return t.replace(tzinfo=dt.UTC) if t is not None and t.tzinfo is None else t


def steps_history(session: Session, user_id: int, end: dt.date, days: int) -> list[StepsDay]:
    """One entry per day, oldest first. A day with no data is null, and two sources are never added up:
    the one synced most recently wins (normally there is only one phone)."""
    start = end - dt.timedelta(days=days - 1)
    best: dict[dt.date, DailySteps] = {}
    for row in session.exec(
        select(DailySteps).where(DailySteps.user_id == user_id, DailySteps.date >= start, DailySteps.date <= end)
    ).all():
        current = best.get(row.date)
        if current is None or _aware(row.synced_at) > _aware(current.synced_at):
            best[row.date] = row
    out = []
    for i in range(days):
        day = start + dt.timedelta(days=i)
        row = best.get(day)
        out.append(StepsDay(date=day, steps=row.steps if row else None, source=row.source if row else None))
    return out


def connectors(session: Session, user_id: int) -> list[Connector]:
    synced = {
        row.source: row.last_sync_at
        for row in session.exec(select(HealthSync).where(HealthSync.user_id == user_id)).all()
    }
    conn = session.get(WhoopConnection, user_id)
    whoop_connected = bool(conn and conn.access_token)
    return [
        Connector(source=PhoneSource.health_connect, metrics=PHONE_METRICS, last_sync_at=_aware(synced.get(PhoneSource.health_connect))),
        Connector(source=PhoneSource.apple_health, metrics=PHONE_METRICS, last_sync_at=_aware(synced.get(PhoneSource.apple_health))),
        Connector(
            source="whoop",
            metrics=WHOOP_METRICS,
            last_sync_at=_aware(conn.last_sync_at) if whoop_connected else None,
            configured=whoop.is_configured(),
            connected=whoop_connected,
        ),
    ]
