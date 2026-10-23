from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from rapidfuzz import fuzz
from sqlmodel import select

from app.config import PROJECT_DIR, get_settings
from app.database import SessionDep
from app.deps import CurrentUser
from app.models.exercise import (
    AlternativePublic,
    AlternativesOut,
    Exercise,
    ExercisePublic,
    RecognitionOut,
    RecognizedExercise,
    RestPreference,
    RestSetting,
    RestSettingIn,
)
from app.models.user import Profile
from app.models.workout import BestSet, ExerciseHistoryOut, LastSession, PastSet, WorkoutSession, WorkoutSet
from app.services.alternatives import find_alternatives
from app.services.calculations import estimated_1rm
from app.services.machine_classifier import MachineClassifier
from app.services.qr import parse_qr_payload, qr_png
from app.services.recognition import RecognitionError, Recognizer, image_type

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


def _get_exercise(session, exercise_id: int) -> Exercise:
    exercise = session.get(Exercise, exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return exercise


@router.get("/{exercise_id}/alternatives", response_model=AlternativesOut)
def exercise_alternatives(exercise_id: int, user: CurrentUser, session: SessionDep, all_equipment: bool = False):
    """Other exercises from the catalogue for when this one's equipment isn't available.

    "similar" = same movement pattern; "different" = same muscles, different movement (not equivalent).
    Filtered to the equipment in the user's profile unless all_equipment=true.
    """
    exercise = _get_exercise(session, exercise_id)
    profile = session.get(Profile, user.id)
    equipment = profile.equipment if profile else None
    alternatives = find_alternatives(exercise, list(session.exec(select(Exercise)).all()), equipment, all_equipment)
    return AlternativesOut(
        exercise=ExercisePublic.model_validate(exercise),
        equipment=equipment,
        filtered_by_equipment=not all_equipment and equipment is not None,
        alternatives=[
            AlternativePublic(
                exercise=ExercisePublic.model_validate(a.exercise), match=a.match, reasons=a.reasons, differences=a.differences
            )
            for a in alternatives
        ],
    )


def _rest_setting(session, user_id: int, exercise: Exercise) -> RestSetting:
    pref = session.get(RestPreference, (user_id, exercise.id))
    default = ExercisePublic.model_validate(exercise).default_rest_seconds
    profile = session.get(Profile, user_id)
    # This exercise's own time, else the time the user set for all exercises, else the exercise's suggestion
    usual = profile.rest_seconds if profile and profile.rest_seconds else default
    return RestSetting(
        exercise_id=exercise.id,
        default_seconds=usual,
        preferred_seconds=pref.seconds if pref else None,
        seconds=pref.seconds if pref else usual,
    )


@router.get("/{exercise_id}/rest", response_model=RestSetting)
def read_rest(exercise_id: int, user: CurrentUser, session: SessionDep):
    """Rest time between sets for this exercise: the user's own choice if they set one, else the default."""
    return _rest_setting(session, user.id, _get_exercise(session, exercise_id))


@router.put("/{exercise_id}/rest", response_model=RestSetting)
def save_rest(exercise_id: int, data: RestSettingIn, user: CurrentUser, session: SessionDep):
    """Remember the user's rest time for this exercise. seconds=null goes back to the default."""
    exercise = _get_exercise(session, exercise_id)
    pref = session.get(RestPreference, (user.id, exercise.id))
    if data.seconds is None:
        if pref:
            session.delete(pref)
    elif pref:
        pref.seconds = data.seconds
        session.add(pref)
    else:
        session.add(RestPreference(user_id=user.id, exercise_id=exercise.id, seconds=data.seconds))
    session.commit()
    return _rest_setting(session, user.id, exercise)


@router.get("/{exercise_id}/history", response_model=ExerciseHistoryOut)
def exercise_history(
    exercise_id: int,
    user: CurrentUser,
    session: SessionDep,
    exclude_workout_id: int | None = Query(default=None, description="leave out this workout (the one in progress)"),
):
    """The user's last session with this exercise and their best set, to pre-fill the next set and spot records."""
    exercise = _get_exercise(session, exercise_id)
    query = (
        select(WorkoutSet, WorkoutSession)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .where(WorkoutSession.user_id == user.id, WorkoutSet.exercise_id == exercise.id)
    )
    if exclude_workout_id is not None:
        query = query.where(WorkoutSession.id != exclude_workout_id)
    rows = session.exec(query.order_by(WorkoutSession.started_at.desc(), WorkoutSet.id)).all()
    if not rows:
        return ExerciseHistoryOut(exercise_id=exercise.id, last=None, best=None)

    last_workout = rows[0][1]
    last = LastSession(
        workout_id=last_workout.id,
        started_at=last_workout.started_at,
        sets=[PastSet(reps=s.reps, weight_kg=s.weight_kg, rpe=s.rpe) for s, w in rows if w.id == last_workout.id],
    )
    # highest estimated 1RM; for sets without weight, the most reps. Earliest wins a tie.
    s, w = max(reversed(rows), key=lambda r: (estimated_1rm(r[0].weight_kg, r[0].reps), r[0].reps))
    best = BestSet(
        weight_kg=s.weight_kg,
        reps=s.reps,
        e1rm_kg=round(estimated_1rm(s.weight_kg, s.reps), 2),
        started_at=w.started_at,
    )
    return ExerciseHistoryOut(exercise_id=exercise.id, last=last, best=best)


# ---------- recognise a machine from a photo ----------

MAX_PHOTO_BYTES = 15 * 1024 * 1024


def get_recognizer() -> Iterator[Recognizer]:
    """The vision model on this PC (Ollama), for gym photos, screenshots, weights and menus. Tests replace this."""
    s = get_settings()
    with httpx.Client() as http:
        yield Recognizer(http, s.ollama_url, s.ollama_vision_model)


def get_machine_recognizer() -> MachineClassifier:
    """The MobileNet machine classifier (ml/machine_classifier) for photos of one machine. Tests replace this."""
    path = Path(get_settings().machine_model_dir)
    return MachineClassifier(path if path.is_absolute() else PROJECT_DIR / path)


@router.post("/recognize", response_model=RecognitionOut)
def recognize_exercise(
    _: CurrentUser, session: SessionDep, recognizer: Annotated[MachineClassifier, Depends(get_machine_recognizer)],
    image: UploadFile = File(...),
):
    """Up to three exercises from the catalogue that match a photo of a machine, best first.

    The user picks the right one (or searches by name). The photo is only used for this and isn't saved.
    """
    data = image.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The photo is too big. Take it again at a lower quality.")
    if image_type(data) is None:
        raise HTTPException(status_code=415, detail="That isn't a photo the app can read (use JPEG, PNG or WebP).")
    problem = recognizer.problem()
    if problem:
        raise HTTPException(status_code=503, detail=problem)
    catalogue = list(session.exec(select(Exercise).order_by(Exercise.id)).all())
    try:
        guesses, seen = recognizer.recognize(data, catalogue)
    except RecognitionError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    return RecognitionOut(
        guesses=[RecognizedExercise(exercise=g.exercise, confidence=g.confidence) for g in guesses],
        seen=seen,
        model=recognizer.model,
    )
