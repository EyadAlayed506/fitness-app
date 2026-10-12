import datetime as dt
from typing import Annotated, Any

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, delete, func, select

from app.config import get_settings
from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.assistant import (
    AssistantStatus,
    ChatMessage,
    ChatMessageIn,
    ChatMessagePublic,
    ChatReply,
)
from app.services import assistant
from app.services.activity import TzOffset

router = APIRouter(prefix="/assistant", tags=["assistant"])

NOT_SET_UP = (
    "The assistant isn't set up on this server yet: get an API key at console.anthropic.com, put it in the "
    "backend's .env file as ANTHROPIC_API_KEY and restart the backend."
)


def get_assistant_client() -> Any:
    """The Claude API client, or None when no API key is set. Tests replace this with a fake."""
    key = get_settings().anthropic_api_key
    return anthropic.Anthropic(api_key=key, timeout=90.0, max_retries=2) if key else None


AssistantClient = Annotated[Any, Depends(get_assistant_client)]


def _public(m: ChatMessage) -> ChatMessagePublic:
    return ChatMessagePublic(
        id=m.id, role=m.role, text=m.text, created_at=m.created_at,
        tools_used=[t for t in m.tools_used.split(",") if t],
    )


def _left_today(session: Session, user_id: int) -> int:
    since = dt.datetime.now(dt.UTC) - dt.timedelta(days=1)
    asked = session.exec(
        select(func.count()).select_from(ChatMessage).where(
            ChatMessage.user_id == user_id, ChatMessage.role == "user", ChatMessage.created_at >= since
        )
    ).one()
    return max(0, get_settings().assistant_daily_limit - asked)


@router.get("", response_model=AssistantStatus)
def read_conversation(user: CurrentUser, session: SessionDep, client: AssistantClient):
    messages = session.exec(
        select(ChatMessage).where(ChatMessage.user_id == user.id).order_by(ChatMessage.id)
    ).all()
    return AssistantStatus(
        configured=client is not None,
        model=get_settings().assistant_model,
        messages_left_today=_left_today(session, user.id),
        messages=[_public(m) for m in messages],
        disclaimer=assistant.DISCLAIMER,
    )


@router.post("/messages", response_model=ChatReply)
def send_message(
    data: ChatMessageIn,
    user: CurrentUser,
    profile: CurrentProfile,
    session: SessionDep,
    client: AssistantClient,
    tz_offset: TzOffset = None,
):
    """Ask the assistant something. It can read (never change) this user's data to answer."""
    if client is None:
        raise HTTPException(status_code=503, detail=NOT_SET_UP)
    if _left_today(session, user.id) <= 0:
        raise HTTPException(
            status_code=429,
            detail=f"You've asked {get_settings().assistant_daily_limit} questions in the last 24 hours. Try again later.",
        )
    history = [
        (m.role, m.text)
        for m in session.exec(select(ChatMessage).where(ChatMessage.user_id == user.id).order_by(ChatMessage.id)).all()
    ]
    ctx = assistant.ToolContext(session=session, user=user, profile=profile, tz_offset=tz_offset)
    try:
        answer = assistant.ask(client, get_settings().assistant_model, ctx, history, data.text.strip())
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=502, detail="The Anthropic API key was refused. Check ANTHROPIC_API_KEY in .env.")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="The assistant is busy right now. Try again in a minute.")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"The assistant couldn't answer ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=502, detail="Couldn't reach the assistant service. Check the internet connection.")

    # saved only once there's an answer, so a failed request leaves no half conversation
    question = ChatMessage(user_id=user.id, role="user", text=data.text.strip())
    reply = ChatMessage(user_id=user.id, role="assistant", text=answer.text, tools_used=",".join(dict.fromkeys(answer.tools_used)))
    session.add(question)
    session.add(reply)
    session.commit()
    session.refresh(question)
    session.refresh(reply)
    return ChatReply(question=_public(question), answer=_public(reply), messages_left_today=_left_today(session, user.id))


@router.delete("/messages", status_code=204)
def clear_conversation(user: CurrentUser, session: SessionDep):
    session.exec(delete(ChatMessage).where(ChatMessage.user_id == user.id))
    session.commit()
