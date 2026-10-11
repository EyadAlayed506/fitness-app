from datetime import date

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import select

from app.database import SessionDep
from app.deps import CurrentUser
from app.models.measurement import (
    MEASUREMENT_FIELDS,
    BodyMeasurement,
    BodyMeasurementIn,
    BodyMeasurementPublic,
)
from app.models.user import Profile
from app.services.calculations import navy_body_fat
from app.services.units import to_cm

router = APIRouter(prefix="/measurements", tags=["measurements"])


@router.post("", response_model=BodyMeasurementPublic, status_code=201)
def add_measurement(data: BodyMeasurementIn, user: CurrentUser, session: SessionDep):
    values = {k: (round(to_cm(v, data.unit), 1) if v is not None else None) for k, v in data.model_dump(include=set(MEASUREMENT_FIELDS)).items()}
    if all(v is None for v in values.values()):
        raise HTTPException(status_code=422, detail="Enter at least one measurement")
    entry = BodyMeasurement(user_id=user.id, date=data.date or date.today(), **values)
    profile = session.get(Profile, user.id)
    if profile and entry.waist_cm and entry.neck_cm:
        entry.body_fat_pct = navy_body_fat(profile.sex, profile.height_cm, entry.waist_cm, entry.neck_cm, entry.hips_cm)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.get("", response_model=list[BodyMeasurementPublic])
def list_measurements(user: CurrentUser, session: SessionDep):
    return session.exec(
        select(BodyMeasurement).where(BodyMeasurement.user_id == user.id).order_by(BodyMeasurement.date.desc())
    ).all()


@router.delete("/{measurement_id}", status_code=204)
def delete_measurement(measurement_id: int, user: CurrentUser, session: SessionDep):
    entry = session.get(BodyMeasurement, measurement_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Measurement not found")
    session.delete(entry)
    session.commit()


@router.get("/compare")
def compare_months(
    user: CurrentUser,
    session: SessionDep,
    months: str | None = Query(default=None, description="Two months, e.g. 2026-09,2026-10. Default: the last two months with data"),
):
    """Month vs month: the latest value of each measurement in each month, and the difference."""
    entries = session.exec(
        select(BodyMeasurement).where(BodyMeasurement.user_id == user.id).order_by(BodyMeasurement.date)
    ).all()
    by_month: dict[str, list[BodyMeasurement]] = {}
    for e in entries:
        by_month.setdefault(e.date.strftime("%Y-%m"), []).append(e)

    if months:
        picked = [m.strip() for m in months.split(",")]
        if len(picked) != 2:
            raise HTTPException(status_code=422, detail="Give exactly two months, e.g. 2026-09,2026-10")
    else:
        picked = sorted(by_month)[-2:]
    if len(picked) < 2:
        return {"months": picked, "available_months": sorted(by_month), "rows": []}

    def latest(month: str, field: str) -> float | None:
        for e in reversed(by_month.get(month, [])):
            if getattr(e, field) is not None:
                return getattr(e, field)
        return None

    rows = []
    for field in [*MEASUREMENT_FIELDS, "body_fat_pct"]:
        a, b = latest(picked[0], field), latest(picked[1], field)
        if a is None and b is None:
            continue
        rows.append({
            "field": field,
            "label": field.removesuffix("_cm").replace("_pct", " %").replace("_", " ").capitalize(),
            "first": a,
            "second": b,
            "difference": round(b - a, 1) if a is not None and b is not None else None,
        })
    return {"months": picked, "available_months": sorted(by_month), "rows": rows}
