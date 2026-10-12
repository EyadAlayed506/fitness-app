import datetime as dt

from sqlmodel import Field, SQLModel

from app.models.user import utcnow


class WhoopConnection(SQLModel, table=True):
    """A user's link to their WHOOP account (OAuth tokens). One per user."""

    user_id: int = Field(foreign_key="user.id", primary_key=True)
    # Set while the user is on WHOOP's login page; matches the callback to the user
    oauth_state: str | None = Field(default=None, index=True)
    oauth_state_created_at: dt.datetime | None = None
    # Stored as-is for now; encrypt these before running the app for real users (see ARCHITECTURE.md)
    access_token: str | None = None
    refresh_token: str | None = None
    token_expires_at: dt.datetime | None = None
    whoop_user_id: int | None = None
    whoop_name: str = ""
    connected_at: dt.datetime | None = None
    last_sync_at: dt.datetime | None = None
    created_at: dt.datetime = Field(default_factory=utcnow)


class WhoopStatus(SQLModel):
    configured: bool  # the server has WHOOP app keys
    redirect_uri: str  # must be registered in the WHOOP developer dashboard exactly like this
    connected: bool
    whoop_name: str = ""
    connected_at: dt.datetime | None = None
    last_sync_at: dt.datetime | None = None


class WhoopSyncResult(SQLModel):
    imported: int = 0
    updated: int = 0
    replaced_manual: int = 0
    skipped: bool = False  # True when the last sync was recent and nothing was fetched
    last_sync_at: dt.datetime | None = None
