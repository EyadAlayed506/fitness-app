import datetime as dt
import html
import secrets
from collections.abc import Iterator
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select

from app.database import SessionDep
from app.deps import CurrentUser
from app.models.user import User
from app.models.whoop import WhoopConnection, WhoopStatus, WhoopSyncResult
from app.services import whoop

router = APIRouter(prefix="/whoop", tags=["whoop"])

STATE_MINUTES = 15  # how long the WHOOP login page link stays valid


def get_whoop_http() -> Iterator[httpx.Client]:
    with httpx.Client() as client:
        yield client


WhoopHttp = Annotated[httpx.Client, Depends(get_whoop_http)]


def _connection(session: Session, user: User) -> WhoopConnection | None:
    return session.get(WhoopConnection, user.id)


def _aware(t: dt.datetime | None) -> dt.datetime | None:
    return t.replace(tzinfo=dt.UTC) if t is not None and t.tzinfo is None else t


@router.get("", response_model=WhoopStatus)
def whoop_status(user: CurrentUser, session: SessionDep):
    conn = _connection(session, user)
    connected = bool(conn and conn.access_token)
    return WhoopStatus(
        configured=whoop.is_configured(),
        connected=connected,
        whoop_name=conn.whoop_name if connected else "",
        connected_at=conn.connected_at if connected else None,
        last_sync_at=conn.last_sync_at if connected else None,
    )


@router.post("/connect")
def start_connect(user: CurrentUser, session: SessionDep):
    """Returns the WHOOP login page URL. Open it in a browser; WHOOP sends the user back to /whoop/callback."""
    if not whoop.is_configured():
        raise HTTPException(
            status_code=503,
            detail="WHOOP isn't set up on this server yet: add WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET to the .env file.",
        )
    conn = _connection(session, user) or WhoopConnection(user_id=user.id)
    conn.oauth_state = secrets.token_urlsafe(24)
    conn.oauth_state_created_at = dt.datetime.now(dt.UTC)
    session.add(conn)
    session.commit()
    return {"authorize_url": whoop.authorize_url(conn.oauth_state)}


PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:440px;margin:18vh auto;padding:0 20px;text-align:center;color:#111}}
h1{{font-size:24px}}p{{color:#555;line-height:1.5}}</style></head>
<body><h1>{title}</h1><p>{text}</p></body></html>"""


def _page(title: str, text: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(PAGE.format(title=html.escape(title), text=html.escape(text)), status_code=status)


@router.get("/callback", response_class=HTMLResponse, include_in_schema=False)
def oauth_callback(
    session: SessionDep,
    http: WhoopHttp,
    state: str = "",
    code: str | None = None,
    error: str | None = None,
):
    """WHOOP sends the browser here after the user logs in (or cancels)."""
    conn = session.exec(select(WhoopConnection).where(WhoopConnection.oauth_state == state)).first() if state else None
    created = _aware(conn.oauth_state_created_at) if conn else None
    if conn is None or created is None or dt.datetime.now(dt.UTC) - created > dt.timedelta(minutes=STATE_MINUTES):
        return _page("Link expired", "Go back to the app and tap “Connect WHOOP” again.", 400)
    conn.oauth_state = None
    if error or not code:
        session.add(conn)
        session.commit()
        return _page("WHOOP not connected", "You didn't allow access. You can close this page and try again in the app.")
    try:
        whoop.exchange_code(http, conn, code)
        profile = whoop.fetch_profile(http, conn)
    except whoop.WhoopError as e:
        session.add(conn)
        session.commit()
        return _page("WHOOP not connected", f"{e}. Close this page and try again in the app.", 502)
    conn.whoop_user_id = profile.get("user_id")
    conn.whoop_name = " ".join(filter(None, [profile.get("first_name"), profile.get("last_name")]))
    conn.connected_at = dt.datetime.now(dt.UTC)
    conn.last_sync_at = None
    session.add(conn)
    session.commit()
    try:
        result = whoop.sync(http, session, conn)
        detail = f"Imported {result.imported} nights of sleep from the last {whoop.FIRST_SYNC_DAYS} days."
    except whoop.WhoopError:
        session.add(conn)  # keep a refreshed token
        session.commit()
        detail = "Your sleep will be imported the next time you open the app."
    return _page("WHOOP connected ✓", f"{detail} You can close this page and go back to the app.")


@router.post("/sync", response_model=WhoopSyncResult)
def sync_now(
    user: CurrentUser,
    session: SessionDep,
    http: WhoopHttp,
    stale_minutes: int = Query(default=0, ge=0, description="Skip if the last sync is more recent than this"),
):
    conn = _connection(session, user)
    if conn is None or not conn.access_token:
        raise HTTPException(status_code=409, detail="WHOOP is not connected")
    last = _aware(conn.last_sync_at)
    if stale_minutes and last and dt.datetime.now(dt.UTC) - last < dt.timedelta(minutes=stale_minutes):
        return WhoopSyncResult(skipped=True, last_sync_at=last)
    try:
        return whoop.sync(http, session, conn)
    except whoop.WhoopAuthError as e:
        # The WHOOP login is gone (revoked or expired): forget it so the app offers to connect again.
        # Not a 401: that would log the user out of this app.
        conn.access_token = conn.refresh_token = None
        session.add(conn)
        session.commit()
        raise HTTPException(status_code=409, detail=str(e))
    except whoop.WhoopError as e:
        # Fetching failed before anything was written; keep a refreshed WHOOP token if there is one
        session.add(conn)
        session.commit()
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("", status_code=204)
def disconnect(user: CurrentUser, session: SessionDep, http: WhoopHttp):
    """Disconnect WHOOP. Sleep already imported stays in the log."""
    conn = _connection(session, user)
    if conn is None:
        return
    if conn.access_token:
        whoop.revoke(http, conn)
    session.delete(conn)
    session.commit()
