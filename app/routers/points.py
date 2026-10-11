import datetime as dt

from fastapi import APIRouter
from sqlmodel import select

from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.points import (
    PointAward,
    PointAwardPublic,
    PointsDay,
    PointsOut,
    PointsRulePublic,
)
from app.services.activity import TzOffset, local_today
from app.services.points import RULES, achievements, evaluate, level_for

router = APIRouter(prefix="/points", tags=["points"])

RECENT_DAYS = 14


@router.get("", response_model=PointsOut)
def read_points(user: CurrentUser, profile: CurrentProfile, session: SessionDep, tz_offset: TzOffset = 0):
    """Points total, level, today's points with reasons, and achievements. Gives any new points first."""
    today = local_today(tz_offset)
    new = evaluate(session, user, profile, today, tz_offset)
    awards = list(
        session.exec(select(PointAward).where(PointAward.user_id == user.id).order_by(PointAward.day.desc(), PointAward.id.desc())).all()
    )
    total = sum(a.points for a in awards)
    level, level_start, next_level_at = level_for(total)
    todays = [PointAwardPublic.model_validate(a) for a in awards if a.day == today]
    recent_from = today - dt.timedelta(days=RECENT_DAYS - 1)
    return PointsOut(
        total=total,
        level=level,
        level_start=level_start,
        next_level_at=next_level_at,
        today=PointsDay(date=today, points=sum(a.points for a in todays), awards=todays),
        new=[PointAwardPublic.model_validate(a) for a in new],
        recent=[PointAwardPublic.model_validate(a) for a in awards if a.day >= recent_from],
        achievements=achievements(awards),
        rules=[PointsRulePublic(**vars(r)) for r in RULES.values()],
    )
