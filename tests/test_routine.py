import itertools

import pytest

from app.models.exercise import Exercise
from app.seed import exercise_rows
from app.services.routine import generate_routine
from app.services.schedule import (
    FOCUS_MUSCLES,
    DayChoice,
    back_to_back_pairs,
    plan_warnings,
    recommend_focus,
    validate_day_choices,
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
def test_recommended_sessions_for_every_choice_of_days(n):
    """Every combination of days: 1-3 days are full body every day; 4+ days never put sessions that train
    the same muscles on back-to-back days."""
    for days in itertools.combinations(range(7), n):
        focus, _, _ = recommend_focus(list(days))
        assert set(focus) == set(days)
        if n <= 3:
            assert set(focus.values()) == {"full_body"}
        else:
            for a, b in back_to_back_pairs(list(days)):
                assert not FOCUS_MUSCLES[focus[a]] & FOCUS_MUSCLES[focus[b]], (days, focus)


def test_three_days_default_to_full_body_every_day(catalogue):
    for days in ([MON, WED, FRI], [MON, SAT, SUN], [SUN, TUE, THU]):
        routine = generate_routine(catalogue, days, 45, "gym", "maintain")
        assert [d.focus for d in routine.days] == ["full_body"] * 3
        assert [d.title for d in routine.days] == ["Full body"] * 3
        assert routine.split == "Full body x3" and not routine.customized
    # back-to-back full-body days are allowed but come with a note
    routine = generate_routine(catalogue, [MON, SAT, SUN], 45, "gym", "maintain")
    assert "back to back" in routine.split_reason
    assert any("Saturday (Full body) and Sunday (Full body)" in w for w in routine.warnings)


def test_full_body_days_alternate_exercises(catalogue):
    routine = generate_routine(catalogue, [MON, WED, FRI], 60, "gym", "maintain")
    ids = [[x.exercise_id for x in d.exercises] for d in routine.days]
    assert ids[0] != ids[1]


def test_user_chooses_session_types_and_names(catalogue):
    choices = {MON: DayChoice("full_body"), WED: DayChoice(None, "Heavy day"), FRI: DayChoice("upper", "Arms & chest")}
    routine = generate_routine(catalogue, [MON, WED, FRI], 60, "gym", "maintain", choices)
    assert [(d.focus, d.title, d.custom_name) for d in routine.days] == [
        ("full_body", "Full body", False),
        ("full_body", "Heavy day", True),
        ("upper", "Arms & chest", True),
    ]
    assert [d.recommended_focus for d in routine.days] == ["full_body"] * 3
    assert routine.customized and routine.split == "Full body / Full body / Upper body"
    assert routine.recommended_split == "Full body x3" and "Recommended" in routine.split_reason
    groups = {x.muscle_group for x in routine.days[2].exercises}
    assert groups <= {"chest", "back", "shoulders", "biceps", "triceps", "core"}  # an upper-body day


def test_plan_warnings():
    assert plan_warnings({MON: "upper", TUE: "upper"})[0].startswith("Monday (Upper body) and Tuesday (Upper body)")
    assert "No day in your week trains the legs." in plan_warnings({MON: "upper", WED: "upper"})
    assert plan_warnings({MON: "push", TUE: "pull", THU: "legs"}) == []  # different muscles back to back
    assert plan_warnings({MON: "full_body", WED: "full_body"}) == []


def test_day_choices_are_validated():
    days = [MON, WED]
    assert validate_day_choices({MON: DayChoice("upper", "  Big   arms ")}, days) == {MON: DayChoice("upper", "Big arms")}
    assert validate_day_choices({MON: DayChoice(None, "   ")}, days) == {}  # nothing chosen
    for bad in ({MON: DayChoice("cardio")}, {TUE: DayChoice("upper")}, {MON: DayChoice(None, "x" * 41)}):
        with pytest.raises(ValueError):
            validate_day_choices(bad, days)


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
    assert upper_a.title == upper_b.title == "Upper body"
    assert [x.exercise_id for x in upper_a.exercises] != [x.exercise_id for x in upper_b.exercises]
