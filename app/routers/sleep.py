from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session, select

from app.database import SessionDep
from app.deps import CurrentUser
from app.models.sleep import (
    SleepEntry,
    SleepEntryIn,
    SleepEntryPublic,
    SleepEntryUpdate,
    SleepSource,
    check_times,
)
from app.models.user import User

router = APIRouter(prefix="/sleep", tags=["sleep"])


def _minutes(entry: SleepEntry) -> int:
    return round((entry.wake_time - entry.bedtime).total_seconds() / 60)


def _check_overlap(session: Session, user: User, bedtime, wake_time, exclude_id: int | None = None) -> None:
    """Refuse a sleep that overlaps one already logged, so the same night can't be counted twice."""
    query = select(SleepEntry).where(
        SleepEntry.user_id == user.id, SleepEntry.bedtime < wake_time, SleepEntry.wake_time > bedtime
    )
    if exclude_id is not None:
        query = query.where(SleepEntry.id != exclude_id)
    clash = session.exec(query).first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"This overlaps a sleep you already logged ({clash.bedtime:%d %b %H:%M} → {clash.wake_time:%H:%M}). "
            "Edit that one instead.",
        )


def _get_owned(session: Session, entry_id: int, user: User) -> SleepEntry:
    entry = session.get(SleepEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Sleep entry not found")
    return entry


@router.post("", response_model=SleepEntryPublic, status_code=201)
def log_sleep(data: SleepEntryIn, user: CurrentUser, session: SessionDep):
    """Log a sleep by hand: bedtime and wake-up time (local time), optional quality 1-5 and notes."""
    _check_overlap(session, user, data.bedtime, data.wake_time)
    entry = SleepEntry(user_id=user.id, date=data.wake_time.date(), duration_minutes=0, **data.model_dump())
    entry.duration_minutes = _minutes(entry)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.get("", response_model=list[SleepEntryPublic])
def list_sleep(user: CurrentUser, session: SessionDep, limit: int = Query(default=30, ge=1, le=365)):
    return session.exec(
        select(SleepEntry)
        .where(SleepEntry.user_id == user.id)
        .order_by(SleepEntry.date.desc(), SleepEntry.bedtime.desc())
        .limit(limit)
    ).all()


@router.patch("/{entry_id}", response_model=SleepEntryPublic)
def update_sleep(entry_id: int, data: SleepEntryUpdate, user: CurrentUser, session: SessionDep):
    entry = _get_owned(session, entry_id, user)
    if entry.source != SleepSource.manual and ({"bedtime", "wake_time"} & data.model_fields_set):
        raise HTTPException(status_code=409, detail=f"The times of this sleep come from {entry.source.upper()} and can't be changed")
    # quality can be cleared with null; null for the other fields means "leave as is"
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None or k == "quality"}
    bedtime = changes.get("bedtime") or entry.bedtime
    wake_time = changes.get("wake_time") or entry.wake_time
    try:
        check_times(bedtime, wake_time)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    _check_overlap(session, user, bedtime, wake_time, exclude_id=entry.id)
    entry.sqlmodel_update(changes)
    entry.date = entry.wake_time.date()
    entry.duration_minutes = _minutes(entry)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_sleep(entry_id: int, user: CurrentUser, session: SessionDep):
    session.delete(_get_owned(session, entry_id, user))
    session.commit()
