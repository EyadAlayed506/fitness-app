import datetime as dt
import json
from collections.abc import Iterator
from dataclasses import asdict
from typing import Annotated

import anthropic
import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
from app.services import assistant, speech
from app.services.activity import TzOffset

router = APIRouter(prefix="/assistant", tags=["assistant"])

Backend = assistant.ClaudeBackend | assistant.OllamaBackend


def chosen_provider() -> str:
    """ASSISTANT_PROVIDER, where "auto" means Claude when an API key is set and Ollama otherwise."""
    s = get_settings()
    if s.assistant_provider != "auto":
        return s.assistant_provider
    return "claude" if s.anthropic_api_key else "ollama"


def get_assistant_backend() -> Iterator[Backend]:
    """The AI that answers: Claude (online) or Ollama (on this PC). Tests replace this with a fake."""
    s = get_settings()
    if chosen_provider() == "claude":
        client = anthropic.Anthropic(api_key=s.anthropic_api_key, timeout=90.0, max_retries=2) if s.anthropic_api_key else None
        yield assistant.ClaudeBackend(client, s.assistant_model)
        return
    with httpx.Client() as http:
        yield assistant.OllamaBackend(http, s.ollama_url, s.ollama_model, s.ollama_num_ctx)


AssistantBackend = Annotated[Backend, Depends(get_assistant_backend)]
SpeechToText = Annotated[speech.Transcriber, Depends(speech.get_transcriber)]


def _public(m: ChatMessage) -> ChatMessagePublic:
    return ChatMessagePublic(
        id=m.id, role=m.role, text=m.text, created_at=m.created_at,
        tools_used=[t for t in m.tools_used.split(",") if t],
        actions=json.loads(m.actions) if m.actions else [],
    )


def _left_today(session: Session, user_id: int, backend: Backend) -> int | None:
    """Questions left in the last 24 hours, or None when there's no limit (a free local model)."""
    if not backend.metered:
        return None
    since = dt.datetime.now(dt.UTC) - dt.timedelta(days=1)
    asked = session.exec(
        select(func.count()).select_from(ChatMessage).where(
            ChatMessage.user_id == user_id, ChatMessage.role == "user", ChatMessage.created_at >= since
        )
    ).one()
    return max(0, get_settings().assistant_daily_limit - asked)


@router.get("", response_model=AssistantStatus)
def read_conversation(user: CurrentUser, session: SessionDep, backend: AssistantBackend):
    messages = session.exec(
        select(ChatMessage).where(ChatMessage.user_id == user.id).order_by(ChatMessage.id)
    ).all()
    problem = backend.problem()
    return AssistantStatus(
        configured=problem is None,
        problem=problem,
        provider=backend.provider,
        model=backend.model,
        messages_left_today=_left_today(session, user.id, backend),
        messages=[_public(m) for m in messages],
        disclaimer=assistant.DISCLAIMER,
    )


@router.post("/messages", response_model=ChatReply)
def send_message(
    data: ChatMessageIn,
    user: CurrentUser,
    profile: CurrentProfile,
    session: SessionDep,
    backend: AssistantBackend,
    tz_offset: TzOffset = None,
):
    """Ask the assistant something. It can read (never change) this user's data to answer."""
    problem = backend.problem()
    if problem:
        raise HTTPException(status_code=503, detail=problem)
    left = _left_today(session, user.id, backend)
    if left is not None and left <= 0:
        raise HTTPException(
            status_code=429,
            detail=f"You've asked {get_settings().assistant_daily_limit} questions in the last 24 hours. Try again later.",
        )
    history = [
        (m.role, m.text)
        for m in session.exec(select(ChatMessage).where(ChatMessage.user_id == user.id).order_by(ChatMessage.id)).all()
    ]
    ctx = assistant.ToolContext(session=session, user=user, profile=profile, tz_offset=tz_offset, question=data.text.strip())
    try:
        answer = backend.ask(ctx, history, data.text.strip())
    except assistant.AssistantError as e:
        if not ctx.actions:
            raise HTTPException(status_code=e.status, detail=e.detail)
        # it already changed something: keep the record (and the Undo) even though the answer failed
        done = "; ".join(a.summary for a in ctx.actions)
        answer = assistant.Answer(f"I added: {done}. Then something went wrong: {e.detail}", [])

    # saved only once there's an answer, so a failed request leaves no half conversation
    question = ChatMessage(user_id=user.id, role="user", text=data.text.strip())
    reply = ChatMessage(
        user_id=user.id, role="assistant", text=answer.text, tools_used=",".join(dict.fromkeys(answer.tools_used)),
        actions=json.dumps([asdict(a) for a in ctx.actions]) if ctx.actions else None,
    )
    session.add(question)
    session.add(reply)
    session.commit()
    session.refresh(question)
    session.refresh(reply)
    return ChatReply(
        question=_public(question), answer=_public(reply), messages_left_today=_left_today(session, user.id, backend)
    )


MAX_AUDIO_BYTES = 10 * 1024 * 1024  # about 10 minutes of compressed speech


@router.post("/transcribe")
def transcribe(
    user: CurrentUser,
    transcriber: SpeechToText,
    audio: UploadFile = File(...),
    prompt: str | None = Form(default=None, max_length=500, description="Words likely to be said, e.g. the wake word and exercise names"),
):
    """Turn a voice recording into text (on this PC). The app puts the text in the message box to check and send."""
    data = audio.file.read(MAX_AUDIO_BYTES + 1)
    if not data:
        raise HTTPException(status_code=422, detail="The recording is empty.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="The recording is too long. Keep voice messages under a few minutes.")
    try:
        text = transcriber.transcribe(data, prompt=prompt) if prompt else transcriber.transcribe(data)
    except speech.SpeechError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not text:
        raise HTTPException(status_code=422, detail="I didn't catch any words. Try again a bit closer to the microphone.")
    return {"text": text}


@router.delete("/messages", status_code=204)
def clear_conversation(user: CurrentUser, session: SessionDep):
    session.exec(delete(ChatMessage).where(ChatMessage.user_id == user.id))
    session.commit()
