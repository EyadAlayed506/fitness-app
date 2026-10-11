import json
from pathlib import Path

from sqlmodel import Session, select

from app.models.exercise import Exercise
from app.models.food import Food, FoodSource

SEED_DIR = Path(__file__).parent


def seed_catalogue(session: Session) -> None:
    """Load the starter exercise catalogue and built-in foods once (when the tables are empty)."""
    if session.exec(select(Exercise).limit(1)).first() is None:
        for row in json.loads((SEED_DIR / "exercises.json").read_text()):
            session.add(Exercise(**row))
    if session.exec(select(Food).where(Food.source == FoodSource.builtin).limit(1)).first() is None:
        for row in json.loads((SEED_DIR / "foods.json").read_text()):
            session.add(Food(source=FoodSource.builtin, **row))
    session.commit()
