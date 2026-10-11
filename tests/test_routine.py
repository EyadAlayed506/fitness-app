import itertools

import pytest

from app.models.exercise import Exercise
from app.seed import exercise_rows
from app.services.routine import generate_routine
from app.services.schedule import (
    back_to_back_pairs,
    choose_split,
    cycle_order,
    validate_days,
)

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


@pytest.fixture
def catalogue():
    return [Exercise(id=i + 1, **r) for i, r in enumerate(exercise_rows())]


EXAMPLE_DAYS = [[MON], [SAT, SUN], [MON, THU], [MON, WED, FRI], [SUN, TUE, THU], [SAT, SUN, MON],
                [MON, TUE, THU, FRI], [MON, TUE, WED, THU, FRI], [MON, TUE, WED, THU, FRI, SAT]]


@pytest.mark.parametrize("days", EXAMPLE_DAYS)
@pytest.mark.parametrize("equipment", ["gym", "home", "bodyweight"])
def test_routine_shape(catalogue, days, equipment):
    routine = generate_routine(catalogue, days, 60, equipment, "maintain")
    assert [d.weekday_index for d in routine.days] == sorted(days)
    by_id = {e.id: e for e in catalogue}
    allowed = {"gym": {"gym", "home", "bodyweight"}, "home": {"home", "bodyweight"}, "bodyweight": {"bodyweight"}}
    for day in routine.days:
        ids = [x.exercise_id for x in day.exercises]
        assert len(ids) == len(set(ids)), "no exercise twice in one day"
        assert len(ids) >= 3
        assert all(by_id[i].equipment in allowed[equipment] for i in ids)


def test_sunday_tuesday_thursday_is_not_moved_to_monday_wednesday_friday(catalogue):
    routine = generate_routine(catalogue, [SUN, TUE, THU], 45, "gym", "maintain")
    assert [d.weekday for d in routine.days] == ["Tuesday", "Thursday", "Sunday"]
    assert routine.rest_days == ["Monday", "Wednesday", "Friday", "Saturday"]
    assert routine.days_per_week == 3 and routine.training_days == [TUE, THU, SUN]


def test_changed_days_are_respected(catalogue):
    routine = generate_routine(catalogue, [MON, THU, SAT], 45, "gym", "maintain")
    assert [d.weekday for d in routine.days] == ["Monday", "Thursday", "Saturday"]


@pytest.mark.parametrize("n", range(1, 7))
def test_back_to_back_days_never_repeat_the_same_session(n):
    """For every possible choice of days: two training days in a row never get the same session type."""
    for days in itertools.combinations(range(7), n):
        titles, _, _ = choose_split(list(days))
        assert set(titles) == set(days)
        for a, b in back_to_back_pairs(list(days)):
            assert titles[a] != titles[b], (days, titles)


def test_split_choice_explained():
    titles, name, why = choose_split([SAT, SUN])
    assert name == "Upper / Lower" and "back to back" in why
    titles, name, _ = choose_split([MON, THU])
    assert name == "Full body A / B"
    titles, name, _ = choose_split([MON, WED, FRI])
    assert name == "Full body A / B / A"
    titles, name, _ = choose_split([MON, SAT, SUN])
    assert name == "Push / Pull / Legs"
    # the cycle starts after the longest rest: Saturday, then Sunday, then Monday
    assert cycle_order([MON, SAT, SUN]) == [SAT, SUN, MON]
    assert [titles[d] for d in (SAT, SUN, MON)] == ["Push", "Pull", "Legs"]


def test_back_to_back_includes_sunday_to_monday():
    assert back_to_back_pairs([MON, WED, SUN]) == [(SUN, MON)]
    assert back_to_back_pairs([MON]) == []


def test_validate_days():
    assert validate_days([6, 0, 3]) == [0, 3, 6]
    for bad in ([], [0, 0], [7], [-1], list(range(7))):
        with pytest.raises(ValueError):
            validate_days(bad)


def test_minutes_set_exercise_count(catalogue):
    short = generate_routine(catalogue, [MON, WED, FRI], 30, "gym", "maintain")
    long = generate_routine(catalogue, [MON, WED, FRI], 75, "gym", "maintain")
    assert short.exercises_per_day == 3
    assert long.exercises_per_day == 8


def test_goal_sets_reps_and_cardio(catalogue):
    lose = generate_routine(catalogue, [MON, WED, FRI], 60, "gym", "lose")
    gain = generate_routine(catalogue, [MON, WED, FRI], 60, "gym", "gain")
    assert lose.reps == "10-15" and lose.days[0].cardio_minutes == 15
    assert gain.reps == "6-12" and gain.days[0].cardio_minutes == 0


def test_repeated_day_types_vary(catalogue):
    routine = generate_routine(catalogue, [MON, TUE, THU, FRI], 60, "gym", "maintain")
    upper_a, upper_b = routine.days[0], routine.days[2]
    assert upper_a.title == upper_b.title == "Upper"
    assert [x.exercise_id for x in upper_a.exercises] != [x.exercise_id for x in upper_b.exercises]
