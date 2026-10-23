"""Gyms, machine settings, "photograph a gym", and the photos that teach the app your machines."""

import json
import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlmodel import Session, SQLModel, func, select

from app.config import get_settings
from app.database import SessionDep
from app.deps import CurrentProfile, CurrentUser
from app.models.exercise import Exercise, ExercisePublic, RecognizedExercise
from app.models.gym import (
    Gym,
    GymIn,
    GymPublic,
    GymUpdate,
    MachinePhoto,
    MachinePhotoPublic,
    MachineSetting,
    MachineSettingIn,
    MachineSettingPublic,
    MemoryMatch,
    PhotoIn,
    PhotoMatchStatus,
    SmartRecognitionOut,
    WorkoutGymIn,
)
from app.models.user import User
from app.models.workout import WorkoutSession, WorkoutSet
from app.routers.exercises import MAX_PHOTO_BYTES, get_machine_recognizer, get_recognizer
from app.services import photo_match
from app.services.activity import TzOffset, local_today, user_routine
from app.services.gym_equipment import EQUIPMENT_LABELS, possible
from app.services.machine_classifier import MachineClassifier
from app.services.photo_match import Candidate, Embedder
from app.services.plan import build_plan
from app.services.recognition import RecognitionError, Recognizer, image_type
from app.services.routine import RoutineDay, generate_routine
from app.services.schedule import DayChoice

router = APIRouter(tags=["gyms"])

RecognizerDep = Annotated[Recognizer, Depends(get_recognizer)]
MachineRecognizerDep = Annotated[MachineClassifier, Depends(get_machine_recognizer)]


def get_embedder() -> Embedder:
    """The image model that compares photos (tests replace it with a fake)."""
    return photo_match.get_embedder()


EmbedderDep = Annotated[Embedder, Depends(get_embedder)]


# ---------- gyms ----------

def default_gym(session: Session, user_id: int) -> Gym:
    """The user's default gym; "My gym" is created the first time it's needed.

    The first gym also takes the workouts logged before gyms existed (they were all at one gym).
    """
    gym = session.exec(select(Gym).where(Gym.user_id == user_id, Gym.is_default)).first()
    if gym is None:
        gym = session.exec(select(Gym).where(Gym.user_id == user_id).order_by(Gym.id)).first()
        first = gym is None
        if first:
            gym = Gym(user_id=user_id, name="My gym")
        gym.is_default = True
        session.add(gym)
        session.commit()
        session.refresh(gym)
        if first:
            for workout in session.exec(
                select(WorkoutSession).where(WorkoutSession.user_id == user_id, WorkoutSession.gym_id.is_(None))
            ).all():
                workout.gym_id = gym.id
                session.add(workout)
            session.commit()
    return gym


def owned_gym(session: Session, gym_id: int, user: User) -> Gym:
    gym = session.get(Gym, gym_id)
    if gym is None or gym.user_id != user.id:
        raise HTTPException(status_code=404, detail="Gym not found")
    return gym


def gym_public(session: Session, gym: Gym) -> GymPublic:
    def count(model, *where) -> int:
        return session.exec(select(func.count()).select_from(model).where(*where)).one()

    eq = gym.equipment_dict()
    return GymPublic(
        id=gym.id,
        name=gym.name,
        is_default=gym.is_default,
        machines=eq["machines"],
        equipment=eq["equipment"],
        photos=count(MachinePhoto, MachinePhoto.gym_id == gym.id),
        settings=count(MachineSetting, MachineSetting.gym_id == gym.id),
        workouts=count(WorkoutSession, WorkoutSession.gym_id == gym.id),
    )


def _make_default(session: Session, user_id: int, gym: Gym) -> None:
    for other in session.exec(select(Gym).where(Gym.user_id == user_id, Gym.id != gym.id, Gym.is_default)).all():
        other.is_default = False
        session.add(other)
    gym.is_default = True


@router.get("/gyms", response_model=list[GymPublic])
def list_gyms(user: CurrentUser, session: SessionDep):
    """The user's gyms, the default first."""
    default_gym(session, user.id)
    gyms = session.exec(select(Gym).where(Gym.user_id == user.id).order_by(Gym.id)).all()
    return [gym_public(session, g) for g in sorted(gyms, key=lambda g: not g.is_default)]


@router.post("/gyms", response_model=GymPublic, status_code=201)
def create_gym(data: GymIn, user: CurrentUser, session: SessionDep):
    default_gym(session, user.id)  # the first gym the user had stays, so nothing logged loses its gym
    gym = Gym(user_id=user.id, name=data.name.strip())
    if data.make_default:
        _make_default(session, user.id, gym)
    session.add(gym)
    session.commit()
    session.refresh(gym)
    return gym_public(session, gym)


@router.patch("/gyms/{gym_id}", response_model=GymPublic)
def update_gym(gym_id: int, data: GymUpdate, user: CurrentUser, session: SessionDep):
    gym = owned_gym(session, gym_id, user)
    if data.name is not None:
        gym.name = data.name.strip()
    if data.is_default:
        _make_default(session, user.id, gym)
    session.add(gym)
    session.commit()
    session.refresh(gym)
    return gym_public(session, gym)


@router.delete("/gyms/{gym_id}", status_code=204)
def delete_gym(gym_id: int, user: CurrentUser, session: SessionDep):
    """Remove a gym with its saved photos and machine settings. Its workouts stay (without a gym)."""
    gym = owned_gym(session, gym_id, user)
    if session.exec(select(func.count()).select_from(Gym).where(Gym.user_id == user.id)).one() <= 1:
        raise HTTPException(status_code=409, detail="This is your only gym. Add another one first.")
    for photo in session.exec(select(MachinePhoto).where(MachinePhoto.gym_id == gym.id)).all():
        photo_match.delete_photo_file(photo.file_name)
        session.delete(photo)
    for setting in session.exec(select(MachineSetting).where(MachineSetting.gym_id == gym.id)).all():
        session.delete(setting)
    for workout in session.exec(select(WorkoutSession).where(WorkoutSession.gym_id == gym.id)).all():
        workout.gym_id = None
        session.add(workout)
    was_default = gym.is_default
    session.delete(gym)
    session.commit()
    if was_default:
        default_gym(session, user.id)


@router.put("/workouts/{workout_id}/gym", response_model=GymPublic)
def set_workout_gym(workout_id: int, data: WorkoutGymIn, user: CurrentUser, session: SessionDep):
    """Say which gym a workout was done at (new workouts start at the default gym)."""
    workout = session.get(WorkoutSession, workout_id)
    if workout is None or workout.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workout not found")
    gym = owned_gym(session, data.gym_id, user)
    workout.gym_id = gym.id
    session.add(workout)
    session.commit()
    return gym_public(session, gym)


# ---------- what a gym has ----------

class GymInventory(SQLModel):
    gym_id: int
    exercise_ids: list[int]  # exercises known to be possible here, from any source below
    logged: list[int]  # done in a workout at this gym
    photographed: list[int]  # a saved photo of the machine
    with_settings: list[int]  # machine settings saved
    from_scan: list[int]  # possible with what "photograph a gym" found


@router.get("/gyms/{gym_id}/inventory", response_model=GymInventory)
def gym_inventory(gym_id: int, user: CurrentUser, session: SessionDep):
    """Exercises known to be possible at this gym (used for "machine taken" swaps)."""
    gym = owned_gym(session, gym_id, user)
    logged = sorted(set(session.exec(
        select(WorkoutSet.exercise_id)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .where(WorkoutSession.user_id == user.id, WorkoutSession.gym_id == gym.id)
    ).all()))
    photographed = sorted(set(session.exec(select(MachinePhoto.exercise_id).where(MachinePhoto.gym_id == gym.id)).all()))
    with_settings = sorted(set(session.exec(select(MachineSetting.exercise_id).where(MachineSetting.gym_id == gym.id)).all()))
    eq = gym.equipment_dict()
    from_scan: list[int] = []
    if eq["machines"] or eq["equipment"]:
        catalogue = list(session.exec(select(Exercise)).all())
        from_scan = sorted(e.id for e in possible(catalogue, set(eq["machines"]), set(eq["equipment"])))
    return GymInventory(
        gym_id=gym.id,
        exercise_ids=sorted(set(logged) | set(photographed) | set(with_settings) | set(from_scan)),
        logged=logged,
        photographed=photographed,
        with_settings=with_settings,
        from_scan=from_scan,
    )


# ---------- machine settings ----------

def _setting_public(gym_id: int, exercise: Exercise, setting: MachineSetting | None) -> MachineSettingPublic:
    values = MachineSettingIn.model_validate(setting).model_dump() if setting else MachineSettingIn().model_dump()
    return MachineSettingPublic(
        **values,
        gym_id=gym_id,
        exercise_id=exercise.id,
        exercise_name=exercise.name,
        saved=setting is not None,
        updated_at=setting.updated_at if setting else None,
    )


def _get_exercise(session: Session, exercise_id: int) -> Exercise:
    exercise = session.get(Exercise, exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return exercise


@router.get("/gyms/{gym_id}/machines", response_model=list[MachineSettingPublic])
def list_machine_settings(gym_id: int, user: CurrentUser, session: SessionDep):
    gym = owned_gym(session, gym_id, user)
    rows = session.exec(
        select(MachineSetting, Exercise)
        .join(Exercise, Exercise.id == MachineSetting.exercise_id)
        .where(MachineSetting.gym_id == gym.id, MachineSetting.user_id == user.id)
        .order_by(Exercise.name)
    ).all()
    return [_setting_public(gym.id, ex, s) for s, ex in rows]


def _find_setting(session: Session, user_id: int, gym_id: int, exercise_id: int) -> MachineSetting | None:
    return session.exec(
        select(MachineSetting).where(
            MachineSetting.user_id == user_id, MachineSetting.gym_id == gym_id, MachineSetting.exercise_id == exercise_id
        )
    ).first()


@router.get("/gyms/{gym_id}/machines/{exercise_id}", response_model=MachineSettingPublic)
def read_machine_setting(gym_id: int, exercise_id: int, user: CurrentUser, session: SessionDep):
    """How the user sets up this machine at this gym (empty when nothing is saved yet)."""
    gym = owned_gym(session, gym_id, user)
    exercise = _get_exercise(session, exercise_id)
    return _setting_public(gym.id, exercise, _find_setting(session, user.id, gym.id, exercise.id))


@router.put("/gyms/{gym_id}/machines/{exercise_id}", response_model=MachineSettingPublic)
def save_machine_setting(gym_id: int, exercise_id: int, data: MachineSettingIn, user: CurrentUser, session: SessionDep):
    """Save the seat, pins, back pad, handle and notes. All empty removes them."""
    gym = owned_gym(session, gym_id, user)
    exercise = _get_exercise(session, exercise_id)
    setting = _find_setting(session, user.id, gym.id, exercise.id)
    values = {k: v.strip() for k, v in data.model_dump().items()}
    if not any(values.values()):
        if setting:
            session.delete(setting)
            session.commit()
        return _setting_public(gym.id, exercise, None)
    if setting is None:
        setting = MachineSetting(user_id=user.id, gym_id=gym.id, exercise_id=exercise.id)
    setting.sqlmodel_update({**values, "updated_at": datetime.now(UTC)})
    session.add(setting)
    session.commit()
    session.refresh(setting)
    return _setting_public(gym.id, exercise, setting)


# ---------- photograph a gym ----------

class ScannedMachine(SQLModel):
    exercise: ExercisePublic
    confidence: float


class ScannedEquipment(SQLModel):
    key: str
    label: str
    confidence: float


class GymScanOut(SQLModel):
    seen: str
    machines: list[ScannedMachine]
    equipment: list[ScannedEquipment]
    model: str
    equipment_choices: dict[str, str]  # every kind of equipment the app knows, key -> label


def _read_photo(image: UploadFile) -> tuple[bytes, str]:
    data = image.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The photo is too big. Take it again at a lower quality.")
    kind = image_type(data)
    if kind is None:
        raise HTTPException(status_code=415, detail="That isn't a photo the app can read (use JPEG, PNG or WebP).")
    return data, kind


@router.post("/gyms/{gym_id}/scan", response_model=GymScanOut)
def scan_gym(gym_id: int, user: CurrentUser, session: SessionDep, recognizer: RecognizerDep, image: UploadFile = File(...)):
    """What the vision model sees in a photo of a gym: machines from the catalogue and other equipment.

    The user ticks what's right (PUT /gyms/{id}/equipment). The photo isn't saved.
    """
    owned_gym(session, gym_id, user)
    data, _ = _read_photo(image)
    problem = recognizer.problem()
    if problem:
        raise HTTPException(status_code=503, detail=problem)
    machines = list(session.exec(select(Exercise).where(Exercise.category == "machine").order_by(Exercise.id)).all())
    try:
        found, equipment, seen = recognizer.scan_gym(data, machines, list(EQUIPMENT_LABELS))
    except RecognitionError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    return GymScanOut(
        seen=seen,
        machines=[ScannedMachine(exercise=ExercisePublic.model_validate(g.exercise), confidence=g.confidence) for g in found],
        equipment=[ScannedEquipment(key=k, label=EQUIPMENT_LABELS[k], confidence=c) for k, c in equipment.items()],
        model=recognizer.model,
        equipment_choices=EQUIPMENT_LABELS,
    )


class GymEquipmentIn(SQLModel):
    machines: list[int] = []  # exercise ids of machines that are there
    equipment: list[str] = []  # keys from equipment_choices


@router.put("/gyms/{gym_id}/equipment", response_model=GymPublic)
def save_gym_equipment(gym_id: int, data: GymEquipmentIn, user: CurrentUser, session: SessionDep):
    """Remember what this gym has (from the scan, as ticked by the user)."""
    gym = owned_gym(session, gym_id, user)
    machine_ids = set(session.exec(select(Exercise.id).where(Exercise.category == "machine")).all())
    gym.equipment = json.dumps({
        "machines": sorted({m for m in data.machines if m in machine_ids}),
        "equipment": [k for k in EQUIPMENT_LABELS if k in set(data.equipment)],
    })
    session.add(gym)
    session.commit()
    session.refresh(gym)
    return gym_public(session, gym)


class GymSessionIn(SQLModel):
    machines: list[int] | None = None  # None: what's saved for the gym
    equipment: list[str] | None = None


class GymSessionOut(SQLModel):
    day: RoutineDay
    possible_exercises: int
    note: str


@router.post("/gyms/{gym_id}/session", response_model=GymSessionOut)
def gym_session(
    gym_id: int, data: GymSessionIn, user: CurrentUser, profile: CurrentProfile, session: SessionDep, tz_offset: TzOffset = None
):
    """Today's session using only what this gym has, following the user's plan for today when there is one."""
    gym = owned_gym(session, gym_id, user)
    saved = gym.equipment_dict()
    machines = set(data.machines if data.machines is not None else saved["machines"])
    equipment = set(data.equipment if data.equipment is not None else saved["equipment"])
    catalogue = list(session.exec(select(Exercise)).all())
    allowed = possible(catalogue, machines, equipment)
    today = local_today(tz_offset).weekday()
    planned = next((d for d in user_routine(session, profile).days if d.weekday_index == today), None)
    focus = planned.focus if planned else "full_body"
    routine = generate_routine(
        allowed,
        [today],
        profile.minutes_per_session,
        "gym",
        build_plan(profile).direction,
        {today: DayChoice(focus, None)},
    )
    day = routine.days[0]
    day.title = f"{day.title} at {gym.name}"
    day.custom_name = True
    note = (
        f"Built from {len(allowed)} exercises possible here"
        + (f", following today's {planned.focus_label.lower()} plan." if planned else " (a full-body session: today isn't a training day).")
    )
    return GymSessionOut(day=day, possible_exercises=len(allowed), note=note)


# ---------- the app learns your machines ----------

def _photo_status(embedder: Embedder) -> PhotoMatchStatus:
    s = get_settings()
    ready = embedder.ready()
    problem = None
    if not ready:
        problem = photo_match.download.error or (
            "The photo-matching model is downloading." if photo_match.download.running
            else "The photo-matching model isn't downloaded yet (351 MB, one time). Until then, photos go to the vision model."
        )
    return PhotoMatchStatus(
        ready=ready,
        downloading=photo_match.download.running,
        downloaded_mb=round(photo_match.download.done_bytes / 1e6, 1),
        size_mb=photo_match.MODEL_SIZE_MB,
        model=embedder.name,
        problem=problem,
        threshold=s.photo_match_threshold,
    )


@router.get("/photo-memory/status", response_model=PhotoMatchStatus)
def photo_memory_status(_: CurrentUser, embedder: EmbedderDep):
    return _photo_status(embedder)


@router.post("/photo-memory/download", response_model=PhotoMatchStatus)
def photo_memory_download(_: CurrentUser, embedder: EmbedderDep):
    """Start downloading the photo-matching model in the background (once)."""
    if not embedder.ready():
        photo_match.download.start(get_settings().photo_match_model_url, photo_match.model_path())
    return _photo_status(embedder)


def _embedding_of(photo: MachinePhoto) -> list[float] | None:
    try:
        return json.loads(photo.embedding) if photo.embedding else None
    except ValueError:
        return None


def _backfill(session: Session, embedder: Embedder, photos: list[MachinePhoto]) -> None:
    """Photos saved before the model was there get their numbers now."""
    changed = False
    for p in photos:
        if p.embedding is None or p.embedding_model != embedder.name:
            try:
                p.embedding = json.dumps(embedder.embed((photo_match.photos_dir() / p.file_name).read_bytes()))
                p.embedding_model = embedder.name
            except (OSError, ValueError):
                continue
            session.add(p)
            changed = True
    if changed:
        session.commit()


@router.post("/photo-memory/recognize", response_model=SmartRecognitionOut)
def smart_recognize(
    user: CurrentUser,
    session: SessionDep,
    recognizer: MachineRecognizerDep,
    embedder: EmbedderDep,
    image: UploadFile = File(...),
    gym_id: int | None = Query(default=None, description="the gym the photo was taken at (default: the default gym)"),
):
    """Which machine a photo shows: first from the user's own earlier photos, else the machine classifier.

    The photo is kept for a day so the user can confirm it (POST /photo-memory/photos), which teaches
    the app this machine. It never leaves this server.
    """
    data, kind = _read_photo(image)
    gym = owned_gym(session, gym_id, user) if gym_id is not None else default_gym(session, user.id)
    settings = get_settings()

    embedding: list[float] | None = None
    match: MemoryMatch | None = None
    started = time.perf_counter()
    if embedder.ready():
        try:
            embedding = embedder.embed(data)
        except (OSError, ValueError) as e:
            raise HTTPException(status_code=415, detail=f"The app couldn't read that photo ({e}).")
        photos = list(session.exec(select(MachinePhoto).where(MachinePhoto.user_id == user.id)).all())
        _backfill(session, embedder, photos)
        candidates = [
            Candidate(p.id, p.exercise_id, vec)
            for p in photos
            if (vec := _embedding_of(p)) is not None and p.embedding_model == embedder.name
        ]
        ranked = photo_match.nearest(embedding, candidates)
        if ranked and ranked[0].similarity >= settings.photo_match_threshold:
            best = ranked[0]
            photo = session.get(MachinePhoto, best.key)
            match = MemoryMatch(
                exercise=ExercisePublic.model_validate(session.get(Exercise, best.exercise_id)),
                similarity=best.similarity,
                photo_id=best.key,
                taken_at=photo.created_at,
            )
    memory_seconds = round(time.perf_counter() - started, 3)
    token = photo_match.save_pending(user.id, data, kind, embedding, embedder.name if embedding else None)

    if match:
        return SmartRecognitionOut(
            source="memory",
            photo_token=token,
            match=match,
            guesses=[RecognizedExercise(exercise=match.exercise, confidence=match.similarity)],
            seen="",
            model=embedder.name,
            problem=None,
            memory_ready=True,
            memory_seconds=memory_seconds,
        )

    # nothing close enough: ask the machine classifier (if its model file is there)
    problem = recognizer.problem()
    if problem:
        return SmartRecognitionOut(
            source="none", photo_token=token, match=None, guesses=[], seen="", model=recognizer.model,
            problem=problem, memory_ready=embedder.ready(), memory_seconds=memory_seconds,
        )
    catalogue = list(session.exec(select(Exercise).order_by(Exercise.id)).all())
    try:
        guesses, seen = recognizer.recognize(data, catalogue)
    except RecognitionError as e:
        return SmartRecognitionOut(
            source="none", photo_token=token, match=None, guesses=[], seen="", model=recognizer.model,
            problem=e.detail, memory_ready=embedder.ready(), memory_seconds=memory_seconds,
        )
    return SmartRecognitionOut(
        source="model" if guesses else "none",
        photo_token=token,
        match=None,
        guesses=[RecognizedExercise(exercise=g.exercise, confidence=g.confidence) for g in guesses],
        seen=seen,
        model=recognizer.model,
        problem=None,
        memory_ready=embedder.ready(),
        memory_seconds=memory_seconds,
    )


def _photo_public(photo: MachinePhoto, exercise_name: str) -> MachinePhotoPublic:
    return MachinePhotoPublic(
        id=photo.id,
        exercise_id=photo.exercise_id,
        exercise_name=exercise_name,
        gym_id=photo.gym_id,
        thumbnail=photo.thumbnail,
        corrected=photo.corrected,
        matchable=photo.embedding is not None,
        created_at=photo.created_at,
    )


@router.post("/photo-memory/photos", response_model=MachinePhotoPublic, status_code=201)
def save_photo(data: PhotoIn, user: CurrentUser, session: SessionDep, embedder: EmbedderDep):
    """Remember a photo as this machine (the user confirmed the guess, or picked the right one)."""
    exercise = _get_exercise(session, data.exercise_id)
    gym = owned_gym(session, data.gym_id, user) if data.gym_id is not None else default_gym(session, user.id)
    pending = photo_match.take_pending(user.id, data.photo_token)
    if pending is None:
        raise HTTPException(status_code=404, detail="That photo is no longer waiting to be saved. Take it again.")
    image, ext, embedding, model = pending
    if embedding is None and embedder.ready():
        embedding, model = embedder.embed(image), embedder.name
    photo = MachinePhoto(
        user_id=user.id,
        gym_id=gym.id,
        exercise_id=exercise.id,
        file_name=photo_match.store_photo(user.id, image, ext),
        thumbnail=photo_match.thumbnail(image),
        embedding=json.dumps(embedding) if embedding else None,
        embedding_model=model if embedding else None,
        corrected=data.corrected,
    )
    session.add(photo)
    session.commit()
    session.refresh(photo)
    return _photo_public(photo, exercise.name)


@router.get("/photo-memory/photos", response_model=list[MachinePhotoPublic])
def list_photos(user: CurrentUser, session: SessionDep, gym_id: int | None = None):
    """The user's saved machine photos, newest first (one gym, or all)."""
    query = (
        select(MachinePhoto, Exercise.name)
        .join(Exercise, Exercise.id == MachinePhoto.exercise_id)
        .where(MachinePhoto.user_id == user.id)
    )
    if gym_id is not None:
        query = query.where(MachinePhoto.gym_id == gym_id)
    return [_photo_public(p, name) for p, name in session.exec(query.order_by(MachinePhoto.id.desc())).all()]


@router.delete("/photo-memory/photos/{photo_id}", status_code=204)
def delete_photo(photo_id: int, user: CurrentUser, session: SessionDep):
    photo = session.get(MachinePhoto, photo_id)
    if photo is None or photo.user_id != user.id:
        raise HTTPException(status_code=404, detail="Photo not found")
    photo_match.delete_photo_file(photo.file_name)
    session.delete(photo)
    session.commit()
