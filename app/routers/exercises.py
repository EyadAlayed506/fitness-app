from fastapi import APIRouter, HTTPException, Query, Response
from rapidfuzz import fuzz
from sqlmodel import select

from app.database import SessionDep
from app.deps import CurrentUser
from app.models.exercise import Exercise, ExercisePublic
from app.services.qr import parse_qr_payload, qr_png

router = APIRouter(prefix="/exercises", tags=["exercises"])


@router.get("", response_model=list[ExercisePublic])
def search_exercises(
    _: CurrentUser,
    session: SessionDep,
    search: str = "",
    muscle_group: str | None = None,
    limit: int = Query(default=10, le=100),
):
    """Typed name search. Fuzzy, so 'lat pull down' and 'latpulldown' both find Lat Pulldown."""
    query = select(Exercise)
    if muscle_group:
        query = query.where(Exercise.muscle_group == muscle_group)
    exercises = list(session.exec(query.order_by(Exercise.name)).all())
    if not search.strip():
        return exercises[:limit]

    def squash(s: str) -> str:
        return "".join(ch for ch in s.lower() if ch.isalnum() or ch == " ")

    # Score each exercise by its best match among its name and aliases
    best: dict[int, float] = {}
    q = squash(search)
    for ex in exercises:
        names = [ex.name, *[a for a in ex.aliases.split(",") if a.strip()]]
        scores = [fuzz.WRatio(q, squash(n)) for n in names]
        scores += [fuzz.ratio(q.replace(" ", ""), squash(n).replace(" ", "")) for n in names]
        best[ex.id] = max(scores)
    ranked = sorted((e for e in exercises if best[e.id] >= 60), key=lambda e: -best[e.id])
    return ranked[:limit]


@router.get("/qr/{code:path}", response_model=ExercisePublic)
def exercise_by_qr(code: str, _: CurrentUser, session: SessionDep):
    """Look up a machine by the code inside its QR sticker (fitapp://machine/<code> or just <code>)."""
    code = parse_qr_payload(code)
    exercise = session.exec(select(Exercise).where(Exercise.qr_code == code)).first()
    if exercise is None:
        raise HTTPException(status_code=404, detail="No machine with this QR code")
    return exercise


@router.get("/{exercise_id}", response_model=ExercisePublic)
def read_exercise(exercise_id: int, _: CurrentUser, session: SessionDep):
    exercise = session.get(Exercise, exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return exercise


@router.get("/{exercise_id}/qr.png", responses={200: {"content": {"image/png": {}}}})
def exercise_qr_sticker(exercise_id: int, session: SessionDep):
    """QR sticker image to print and put on the machine. Public: the code is printed on the machine anyway."""
    exercise = session.get(Exercise, exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return Response(content=qr_png(exercise.qr_code), media_type="image/png")
