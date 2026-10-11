import json

import pytest

from app.models.exercise import Exercise
from app.seed import SEED_DIR
from app.services.routine import generate_routine


@pytest.fixture
def catalogue():
    rows = json.loads((SEED_DIR / "exercises.json").read_text())
    return [Exercise(id=i + 1, **r) for i, r in enumerate(rows)]


@pytest.mark.parametrize("days", [1, 2, 3, 4, 5, 6])
@pytest.mark.parametrize("equipment", ["gym", "home", "bodyweight"])
def test_routine_shape(catalogue, days, equipment):
    routine = generate_routine(catalogue, days, 60, equipment, "maintain")
    assert len(routine.days) == days
    by_id = {e.id: e for e in catalogue}
    allowed = {"gym": {"gym", "home", "bodyweight"}, "home": {"home", "bodyweight"}, "bodyweight": {"bodyweight"}}
    for day in routine.days:
        ids = [x.exercise_id for x in day.exercises]
        assert len(ids) == len(set(ids)), "no exercise twice in one day"
        assert len(ids) >= 3
        assert all(by_id[i].equipment in allowed[equipment] for i in ids)


def test_minutes_set_exercise_count(catalogue):
    short = generate_routine(catalogue, 3, 30, "gym", "maintain")
    long = generate_routine(catalogue, 3, 75, "gym", "maintain")
    assert short.exercises_per_day == 3
    assert long.exercises_per_day == 8


def test_goal_sets_reps_and_cardio(catalogue):
    lose = generate_routine(catalogue, 3, 60, "gym", "lose")
    gain = generate_routine(catalogue, 3, 60, "gym", "gain")
    assert lose.reps == "10-15" and lose.days[0].cardio_minutes == 15
    assert gain.reps == "6-12" and gain.days[0].cardio_minutes == 0


def test_repeated_day_types_vary(catalogue):
    routine = generate_routine(catalogue, 4, 60, "gym", "maintain")
    upper_a, upper_b = routine.days[0], routine.days[2]
    assert [x.exercise_id for x in upper_a.exercises] != [x.exercise_id for x in upper_b.exercises]
