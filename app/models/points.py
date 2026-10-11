import datetime as dt

from sqlmodel import Field, SQLModel, UniqueConstraint

from app.models.user import utcnow


class PointAward(SQLModel, table=True):
    """Points given for one thing the user did. Never edited or taken back once given.

    `key` names what the points are for (e.g. "sleep_goal:2026-10-12"); it is unique per user, so the
    same thing can never earn points twice, however often the rules are checked.
    """

    __table_args__ = (UniqueConstraint("user_id", "key"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    rule: str
    key: str
    points: int
    day: dt.date  # the user's day the points count for
    reason: str
    data_source: str  # "manual" (entered by the user) or "whoop" (from a connected tracker)
    created_at: dt.datetime = Field(default_factory=utcnow)


class PointAwardPublic(SQLModel):
    rule: str
    points: int
    day: dt.date
    reason: str
    data_source: str


class PointsRulePublic(SQLModel):
    id: str
    points: int
    label: str
    description: str


class Achievement(SQLModel):
    id: str
    title: str
    description: str
    earned: bool
    progress: int
    target: int


class PointsDay(SQLModel):
    date: dt.date
    points: int
    awards: list[PointAwardPublic]


class PointsOut(SQLModel):
    total: int
    level: int
    level_start: int  # total points where this level started
    next_level_at: int
    today: PointsDay
    new: list[PointAwardPublic]  # given by this request (to show "+20 points" right after an action)
    recent: list[PointAwardPublic]
    achievements: list[Achievement]
    rules: list[PointsRulePublic]
