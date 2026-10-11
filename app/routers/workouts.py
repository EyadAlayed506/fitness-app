from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session, delete, func, select

from app.database import SessionDep
from app.deps import CurrentUser
from app.models.exercise import Exercise
from app.models.user import User
from app.models.workout import (
    WorkoutSession,
    WorkoutSessionIn,
    WorkoutSessionPublic,
    WorkoutSessionUpdate,
    WorkoutSet,
    WorkoutSetIn,
    WorkoutSetPublic,
    WorkoutSetUpdate,
)
from app.services.units import to_kg

router = APIRouter(prefix="/workouts", tags=["workouts"])


def _get_owned_session(session: Session, workout_id: int, user: User) -> WorkoutSession:
    workout = session.get(WorkoutSession, workout_id)
    if workout is None or workout.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workout not found")
    return workout


def _set_public(s: WorkoutSet, exercise_name: str) -> WorkoutSetPublic:
    return WorkoutSetPublic.model_validate(s, update={"exercise_name": exercise_name})


def _session_public(session: Session, workout: WorkoutSession, with_sets: bool) -> WorkoutSessionPublic:
    rows = session.exec(
        select(WorkoutSet, Exercise.name)
        .join(Exercise, Exercise.id == WorkoutSet.exercise_id)
        .where(WorkoutSet.session_id == workout.id)
        .order_by(WorkoutSet.id)
    ).all()
    sets = [_set_public(s, name) for s, name in rows]
    return WorkoutSessionPublic(
        id=workout.id,
        started_at=workout.started_at,
        ended_at=workout.ended_at,
        notes=workout.notes,
        set_count=len(sets),
        volume_kg=round(sum(s.reps * s.weight_kg for s in sets), 1),
        sets=sets if with_sets else [],
    )


@router.post("", response_model=WorkoutSessionPublic, status_code=201)
def start_workout(data: WorkoutSessionIn, user: CurrentUser, session: SessionDep):
    workout = WorkoutSession(user_id=user.id, notes=data.notes)
    if data.started_at:
        workout.started_at = data.started_at
    session.add(workout)
    session.commit()
    session.refresh(workout)
    return _session_public(session, workout, with_sets=True)


@router.get("", response_model=list[WorkoutSessionPublic])
def list_workouts(user: CurrentUser, session: SessionDep, limit: int = Query(default=20, le=200)):
    workouts = session.exec(
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user.id)
        .order_by(WorkoutSession.started_at.desc())
        .limit(limit)
    ).all()
    return [_session_public(session, w, with_sets=False) for w in workouts]


@router.get("/{workout_id}", response_model=WorkoutSessionPublic)
def read_workout(workout_id: int, user: CurrentUser, session: SessionDep):
    return _session_public(session, _get_owned_session(session, workout_id, user), with_sets=True)


@router.patch("/{workout_id}", response_model=WorkoutSessionPublic)
def update_workout(workout_id: int, data: WorkoutSessionUpdate, user: CurrentUser, session: SessionDep):
    workout = _get_owned_session(session, workout_id, user)
    if data.finish:
        workout.ended_at = datetime.now(UTC)
    elif data.ended_at is not None:
        workout.ended_at = data.ended_at
    if data.notes is not None:
        workout.notes = data.notes
    session.add(workout)
    session.commit()
    session.refresh(workout)
    return _session_public(session, workout, with_sets=True)


@router.delete("/{workout_id}", status_code=204)
def delete_workout(workout_id: int, user: CurrentUser, session: SessionDep):
    workout = _get_owned_session(session, workout_id, user)
    session.exec(delete(WorkoutSet).where(WorkoutSet.session_id == workout.id))
    session.delete(workout)
    session.commit()


@router.post("/{workout_id}/sets", response_model=WorkoutSetPublic, status_code=201)
def add_set(workout_id: int, data: WorkoutSetIn, user: CurrentUser, session: SessionDep):
    workout = _get_owned_session(session, workout_id, user)
    exercise = session.get(Exercise, data.exercise_id)
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    previous = session.exec(
        select(func.count()).select_from(WorkoutSet).where(
            WorkoutSet.session_id == workout.id, WorkoutSet.exercise_id == exercise.id
        )
    ).one()
    workout_set = WorkoutSet(
        session_id=workout.id,
        exercise_id=exercise.id,
        set_number=previous + 1,
        reps=data.reps,
        weight_kg=round(to_kg(data.weight, data.unit), 2),
        rpe=data.rpe,
        rest_seconds=data.rest_seconds,
        notes=data.notes,
        added_via=data.added_via,
    )
    session.add(workout_set)
    session.commit()
    session.refresh(workout_set)
    return _set_public(workout_set, exercise.name)


def _get_owned_set(session: Session, workout_id: int, set_id: int, user: User) -> WorkoutSet:
    _get_owned_session(session, workout_id, user)
    workout_set = session.get(WorkoutSet, set_id)
    if workout_set is None or workout_set.session_id != workout_id:
        raise HTTPException(status_code=404, detail="Set not found")
    return workout_set


@router.patch("/{workout_id}/sets/{set_id}", response_model=WorkoutSetPublic)
def update_set(workout_id: int, set_id: int, data: WorkoutSetUpdate, user: CurrentUser, session: SessionDep):
    workout_set = _get_owned_set(session, workout_id, set_id, user)
    changes = data.model_dump(exclude_unset=True, exclude={"weight", "unit"})
    if data.weight is not None:
        changes["weight_kg"] = round(to_kg(data.weight, data.unit), 2)
    workout_set.sqlmodel_update(changes)
    session.add(workout_set)
    session.commit()
    session.refresh(workout_set)
    return _set_public(workout_set, session.get(Exercise, workout_set.exercise_id).name)


@router.delete("/{workout_id}/sets/{set_id}", status_code=204)
def delete_set(workout_id: int, set_id: int, user: CurrentUser, session: SessionDep):
    session.delete(_get_owned_set(session, workout_id, set_id, user))
    session.commit()
