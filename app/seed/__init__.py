import json
from pathlib import Path

from sqlmodel import Session, select

from app.models.exercise import Exercise
from app.models.food import Food, FoodSource

SEED_DIR = Path(__file__).parent


def exercise_rows() -> list[dict]:
    # UTF-8 always: Windows' default encoding would garble the Arabic text
    rows = json.loads((SEED_DIR / "exercises.json").read_text(encoding="utf-8"))
    for row in rows:
        row["instructions"] = "\n".join(row.get("instructions") or [])
        row["instructions_ar"] = "\n".join(row.get("instructions_ar") or []) or None
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
    food_rows = json.loads((SEED_DIR / "foods.json").read_text(encoding="utf-8"))
    builtin = {f.name: f for f in session.exec(select(Food).where(Food.source == FoodSource.builtin)).all()}
    if not builtin:
        for row in food_rows:
            session.add(Food(source=FoodSource.builtin, **row))
    else:
        # An existing database only gains the Arabic names (matched by English name). Nutrition values,
        # ids and anyone's food log are left exactly as they are.
        for row in food_rows:
            food = builtin.get(row["name"])
            if food is not None and (food.name_ar, food.aliases_ar) != (row.get("name_ar"), row.get("aliases_ar")):
                food.name_ar, food.aliases_ar = row.get("name_ar"), row.get("aliases_ar")
                session.add(food)
    session.commit()
