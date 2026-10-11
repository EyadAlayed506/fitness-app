import json
from pathlib import Path

from sqlmodel import Session, select

from app.models.exercise import Exercise
from app.models.food import Food, FoodSource

SEED_DIR = Path(__file__).parent


def exercise_rows() -> list[dict]:
    rows = json.loads((SEED_DIR / "exercises.json").read_text())
    for row in rows:
        row["instructions"] = "\n".join(row.get("instructions") or [])
    return rows


def seed_catalogue(session: Session) -> None:
    """Load the exercise catalogue and built-in foods.

    Exercises are matched by their QR code, so a newer seed file updates existing machines
    (names, instructions, rest times) without changing their ids or anyone's workout history.
    """
    existing = {e.qr_code: e for e in session.exec(select(Exercise)).all()}
    for row in exercise_rows():
        exercise = existing.get(row["qr_code"])
        if exercise is None:
            session.add(Exercise(**row))
        else:
            exercise.sqlmodel_update(row)
            session.add(exercise)
    if session.exec(select(Food).where(Food.source == FoodSource.builtin).limit(1)).first() is None:
        for row in json.loads((SEED_DIR / "foods.json").read_text()):
            session.add(Food(source=FoodSource.builtin, **row))
    session.commit()
