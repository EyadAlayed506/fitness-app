"""WHOOP API v2: OAuth login, token refresh and importing sleep (with stages and recovery)."""

import datetime as dt
import re
from collections.abc import Iterator
from urllib.parse import urlencode

import httpx
from sqlmodel import Session, select

from app.config import get_settings
from app.models.sleep import MAX_SLEEP_HOURS, SleepEntry, SleepSource
from app.models.whoop import WhoopConnection, WhoopSyncResult

AUTHORIZE_PATH = "/oauth/oauth2/auth"
TOKEN_PATH = "/oauth/oauth2/token"
API_PATH = "/developer"
# offline = a refresh token, so the app keeps syncing without asking the user to log in again
SCOPES = "offline read:profile read:sleep read:recovery"
PAGE_SIZE = 25  # WHOOP's maximum
FIRST_SYNC_DAYS = 30
RESYNC_OVERLAP = dt.timedelta(days=3)  # re-read recent nights: WHOOP scores them after a delay


class WhoopError(Exception):
    """WHOOP could not be reached or answered with an error."""


class WhoopAuthError(WhoopError):
    """The WHOOP login is no longer valid; the user has to connect again."""


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _url(path: str) -> str:
    return get_settings().whoop_base_url.rstrip("/") + path


def is_configured() -> bool:
    s = get_settings()
    return bool(s.whoop_client_id and s.whoop_client_secret)


def authorize_url(state: str) -> str:
    s = get_settings()
    params = {
        "response_type": "code",
        "client_id": s.whoop_client_id,
        "redirect_uri": s.whoop_redirect_uri,
        "scope": SCOPES,
        "state": state,
    }
    return f"{_url(AUTHORIZE_PATH)}?{urlencode(params)}"


# ---------- tokens ----------

def _token_request(http: httpx.Client, data: dict) -> dict:
    s = get_settings()
    try:
        resp = http.post(
            _url(TOKEN_PATH),
            data={**data, "client_id": s.whoop_client_id, "client_secret": s.whoop_client_secret},
            timeout=s.external_timeout_seconds,
        )
    except httpx.HTTPError as e:
        raise WhoopError("WHOOP is not reachable right now") from e
    if resp.status_code in (400, 401):
        raise WhoopAuthError("WHOOP did not accept the login. Connect WHOOP again.")
    if resp.status_code >= 300:
        raise WhoopError(f"WHOOP answered with an error ({resp.status_code})")
    return resp.json()


def _save_tokens(conn: WhoopConnection, data: dict) -> None:
    conn.access_token = data["access_token"]
    # WHOOP may send a new refresh token each time; keep the old one if it doesn't
    conn.refresh_token = data.get("refresh_token") or conn.refresh_token
    expires_in = int(data.get("expires_in", 3600))
    conn.token_expires_at = utcnow() + dt.timedelta(seconds=max(60, expires_in - 60))


def exchange_code(http: httpx.Client, conn: WhoopConnection, code: str) -> None:
    s = get_settings()
    _save_tokens(
        conn, _token_request(http, {"grant_type": "authorization_code", "code": code, "redirect_uri": s.whoop_redirect_uri})
    )


def _ensure_token(http: httpx.Client, conn: WhoopConnection) -> str:
    if not conn.access_token:
        raise WhoopAuthError("WHOOP is not connected")
    expires = conn.token_expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=dt.UTC)
    if expires is None or expires <= utcnow():
        if not conn.refresh_token:
            raise WhoopAuthError("The WHOOP login expired. Connect WHOOP again.")
        _save_tokens(
            conn, _token_request(http, {"grant_type": "refresh_token", "refresh_token": conn.refresh_token, "scope": "offline"})
        )
    return conn.access_token


# ---------- API ----------

def _get(http: httpx.Client, conn: WhoopConnection, path: str, params: dict | None = None) -> dict:
    token = _ensure_token(http, conn)
    try:
        resp = http.get(
            _url(f"{API_PATH}/{path}"),
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=get_settings().external_timeout_seconds,
        )
    except httpx.HTTPError as e:
        raise WhoopError("WHOOP is not reachable right now") from e
    if resp.status_code == 401:
        raise WhoopAuthError("WHOOP no longer accepts this login. Connect WHOOP again.")
    if resp.status_code == 429:
        raise WhoopError("WHOOP is busy (too many requests). Try again in a minute.")
    if resp.status_code >= 300:
        raise WhoopError(f"WHOOP answered with an error ({resp.status_code})")
    return resp.json()


def _collection(http: httpx.Client, conn: WhoopConnection, path: str, start: dt.datetime, end: dt.datetime) -> Iterator[dict]:
    params = {"start": _iso(start), "end": _iso(end), "limit": PAGE_SIZE}
    for _ in range(100):  # safety stop: 2,500 records
        page = _get(http, conn, path, params)
        yield from page.get("records", [])
        token = page.get("next_token")
        if not token:
            return
        params["nextToken"] = token


def fetch_profile(http: httpx.Client, conn: WhoopConnection) -> dict:
    return _get(http, conn, "v2/user/profile/basic")


def revoke(http: httpx.Client, conn: WhoopConnection) -> None:
    """Tell WHOOP to drop the app's access. Best effort: errors are ignored."""
    try:
        token = _ensure_token(http, conn)
        http.delete(_url(f"{API_PATH}/v2/user/access"), headers={"Authorization": f"Bearer {token}"}, timeout=5)
    except (WhoopError, httpx.HTTPError):
        pass


# ---------- turning WHOOP records into sleep entries ----------

def _iso(t: dt.datetime) -> str:
    return t.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _parse_utc(text: str) -> dt.datetime:
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(dt.UTC)


def _offset(text: str | None) -> dt.timedelta:
    """'-05:00' -> -5 hours. WHOOP gives each sleep the time zone it was recorded in."""
    m = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", text or "")
    if not m:
        return dt.timedelta(0)
    delta = dt.timedelta(hours=int(m[2]), minutes=int(m[3]))
    return -delta if m[1] == "-" else delta


def _local(text: str, offset: dt.timedelta) -> dt.datetime:
    """UTC time from WHOOP -> the clock time where the user slept (no timezone, like manual entries)."""
    return (_parse_utc(text) + offset).replace(tzinfo=None, second=0, microsecond=0)


def quality_from_performance(pct: float | None) -> int | None:
    """WHOOP sleep performance (0-100 %) on the app's 1-5 scale. WHOOP calls 85 %+ optimal."""
    if pct is None:
        return None
    if pct >= 85:
        return 5
    if pct >= 70:
        return 4
    if pct >= 50:
        return 3
    if pct >= 30:
        return 2
    return 1


def entry_fields(record: dict) -> dict | None:
    """Map one WHOOP sleep record to SleepEntry fields. None if it can't be used."""
    if not record.get("start") or not record.get("end"):
        return None
    offset = _offset(record.get("timezone_offset"))
    bedtime = _local(record["start"], offset)
    wake = _local(record["end"], offset)
    in_bed = round((wake - bedtime).total_seconds() / 60)
    if in_bed <= 0 or in_bed > MAX_SLEEP_HOURS * 60:
        return None
    fields: dict = {"bedtime": bedtime, "wake_time": wake, "date": wake.date(), "duration_minutes": in_bed}
    score = record.get("score") if record.get("score_state") == "SCORED" else None
    stages = (score or {}).get("stage_summary") or {}
    if stages:
        minutes = {k: round((stages.get(f"total_{k}_time_milli") or 0) / 60000) for k in ("light_sleep", "slow_wave_sleep", "rem_sleep", "awake")}
        asleep = minutes["light_sleep"] + minutes["slow_wave_sleep"] + minutes["rem_sleep"]
        fields.update(
            light_minutes=minutes["light_sleep"],
            deep_minutes=minutes["slow_wave_sleep"],
            rem_minutes=minutes["rem_sleep"],
            awake_minutes=minutes["awake"],
            duration_minutes=asleep or in_bed,
        )
    perf = (score or {}).get("sleep_performance_percentage")
    fields["performance_pct"] = perf
    fields["quality"] = quality_from_performance(perf)
    return fields


def sync(http: httpx.Client, session: Session, conn: WhoopConnection) -> WhoopSyncResult:
    """Import WHOOP sleeps since the last sync (the first time: the last 30 days)."""
    now = utcnow()
    last = conn.last_sync_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=dt.UTC)
    start = last - RESYNC_OVERLAP if last else now - dt.timedelta(days=FIRST_SYNC_DAYS)

    records = list(_collection(http, conn, "v2/activity/sleep", start, now))
    recovery_by_sleep = {}
    for r in _collection(http, conn, "v2/recovery", start - dt.timedelta(days=1), now):
        if r.get("score_state") == "SCORED" and r.get("sleep_id") and r.get("score"):
            recovery_by_sleep[str(r["sleep_id"])] = r["score"].get("recovery_score")

    result = WhoopSyncResult()
    for record in records:
        fields = entry_fields(record)
        if fields is None:
            continue
        external_id = str(record["id"])
        fields["recovery_score"] = recovery_by_sleep.get(external_id)
        entry = session.exec(
            select(SleepEntry).where(
                SleepEntry.user_id == conn.user_id,
                SleepEntry.source == SleepSource.whoop,
                SleepEntry.external_id == external_id,
            )
        ).first()
        if entry is None:
            entry = SleepEntry(user_id=conn.user_id, source=SleepSource.whoop, external_id=external_id, **fields)
            result.imported += 1
        else:
            notes = entry.notes  # keep the user's own notes on a WHOOP night
            entry.sqlmodel_update(fields)
            entry.notes = notes
            result.updated += 1
        # WHOOP replaces nights the user typed in by hand, so a night is never counted twice
        for manual in session.exec(
            select(SleepEntry).where(
                SleepEntry.user_id == conn.user_id,
                SleepEntry.source == SleepSource.manual,
                SleepEntry.bedtime < fields["wake_time"],
                SleepEntry.wake_time > fields["bedtime"],
            )
        ).all():
            session.delete(manual)
            result.replaced_manual += 1
        session.add(entry)

    conn.last_sync_at = now
    session.add(conn)
    session.commit()
    result.last_sync_at = now
    return result
