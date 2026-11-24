"""Phone health data beyond sleep (daily steps) and one place to see every source's last sync.

Sleep itself stays under /sleep (manual, /sleep/health-connect, /sleep/apple-health) and /whoop.
"""

from fastapi import APIRouter, Query

from app.database import SessionDep
from app.deps import CurrentUser
from app.models.health import Connectors, StepsHistory, StepsUpload, StepsUploadResult
from app.services import health_sync
from app.services.activity import TzOffset, local_today

router = APIRouter(prefix="/health", tags=["health"])


@router.post("/steps", response_model=StepsUploadResult)
def upload_steps(data: StepsUpload, user: CurrentUser, session: SessionDep):
    """Daily step totals the phone read from Health Connect or Apple Health.

    Send each local day once, with the platform's de-duplicated total. Sending a day again replaces it,
    so repeated syncs never add up. Leave out days the platform has no value for (missing is not 0).
    """
    return health_sync.save_steps(session, user.id, data)


@router.get("/steps", response_model=StepsHistory)
def get_steps(
    user: CurrentUser,
    session: SessionDep,
    days: int = Query(default=14, ge=1, le=90),
    tz_offset: TzOffset = None,
):
    """The last `days` local days, oldest first; `steps` is null on days with no data."""
    return StepsHistory(days=health_sync.steps_history(session, user.id, local_today(tz_offset), days))


@router.get("/connectors", response_model=Connectors)
def get_connectors(user: CurrentUser, session: SessionDep):
    """Each health source with what it imports and when it last synced (null: never)."""
    return Connectors(connectors=health_sync.connectors(session, user.id))
