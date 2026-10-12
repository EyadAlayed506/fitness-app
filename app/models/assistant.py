import datetime as dt
from typing import Literal

from sqlmodel import Field, SQLModel

from app.models.user import utcnow


class ChatMessage(SQLModel, table=True):
    """One message in a user's conversation with the assistant (one conversation per user)."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    role: str  # "user" or "assistant"
    text: str
    tools_used: str = ""  # comma-separated tool names the assistant used to answer
    actions: str | None = None  # JSON list of what the assistant changed (see ActionPublic)
    created_at: dt.datetime = Field(default_factory=utcnow)


class ChatMessageIn(SQLModel):
    text: str = Field(min_length=1, max_length=2000)


class ActionPublic(SQLModel):
    """Something the assistant added or removed, with where to see it and how to undo it."""

    kind: str  # "food" | "sets" | "weight" | "sleep" | "removed"
    summary: str
    screen: str  # app route, e.g. "/food"
    undo: list[str]  # API paths to DELETE; empty when it can't be undone


class ChatMessagePublic(SQLModel):
    id: int
    role: Literal["user", "assistant"]
    text: str
    tools_used: list[str]
    actions: list[ActionPublic] = []
    created_at: dt.datetime


class AssistantStatus(SQLModel):
    configured: bool  # the AI is ready to answer
    problem: str | None  # why not, and how to fix it
    provider: Literal["claude", "ollama"]
    model: str
    messages_left_today: int | None  # None: no limit (a free local model)
    messages: list[ChatMessagePublic]
    disclaimer: str


class ChatReply(SQLModel):
    question: ChatMessagePublic
    answer: ChatMessagePublic
    messages_left_today: int | None
