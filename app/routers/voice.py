"""Hands-free workout commands: the AI fallback (only for words the app couldn't read itself)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from sqlmodel import Field, SQLModel

from app.database import SessionDep
from app.deps import CurrentUser
from app.routers.assistant import AssistantBackend, _left_today
from app.services import assistant, voice

router = APIRouter(prefix="/voice", tags=["hands-free"])


class InterpretIn(SQLModel):
    text: str = Field(min_length=1, max_length=300)
    current_exercise: str | None = Field(default=None, max_length=120)
    plan: list[str] = Field(default_factory=list, max_length=20)
    unit: Literal["kg", "lb"] = "kg"


class InterpretOut(SQLModel):
    command: dict | None  # the app's command shape, or None when it isn't a workout command


@router.post("/interpret", response_model=InterpretOut)
def interpret(data: InterpretIn, user: CurrentUser, session: SessionDep, backend: AssistantBackend):
    """Words the app's parser couldn't read, as a structured workout command (checked here and in the app)."""
    problem = backend.problem()
    if problem:
        raise HTTPException(status_code=503, detail=problem)
    left = _left_today(session, user.id, backend)
    if left is not None and left <= 0:
        raise HTTPException(status_code=429, detail="The assistant's daily limit is used up. Say the command more simply.")
    prompt = voice.prompt_for(data.text, data.current_exercise, data.plan[:20], data.unit)
    try:
        raw = backend.interpret(prompt, voice.SCHEMA)
    except assistant.AssistantError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    return InterpretOut(command=voice.clean_command(raw))
