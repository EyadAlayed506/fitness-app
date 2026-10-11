import datetime as dt

import pytest

from app.models.exercise import Exercise
from app.models.sleep import SleepEntry
from app.models.workout import WorkoutSet
from app.seed import exercise_rows
from app.services.activity import DoneWorkout, SleepGoal
from app.services.recommendations import DISCLAIMER, Context, recommend
from app.services.routine import generate_routine
from tests.conftest import PROFILE

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)
MONDAY = dt.date(2026, 10, 12)  # a Monday
GOAL = SleepGoal(minutes=8 * 60, custom=True, recommended_hours=(7, 9))


@pytest.fixture
def catalogue():
    return [Exercise(id=i + 1, **r) for i, r in enumerate(exercise_rows())]


def night(day: dt.date, minutes: int, source="manual", recovery=None) -> SleepEntry:
    wake = dt.datetime.combine(day, dt.time(7))
    return SleepEntry(
        user_id=1, date=day, bedtime=wake - dt.timedelta(minutes=minutes), wake_time=wake,
        duration_minutes=minutes, source=source, recovery_score=recovery,
    )


def workout(day: dt.date, exercise_id: int, reps: list[int], weight=50.0, wid=1) -> DoneWorkout:
    started = dt.datetime.combine(day, dt.time(18), dt.UTC)
    sets = [(WorkoutSet(session_id=wid, exercise_id=exercise_id, set_number=i + 1, reps=r, weight_kg=weight), None)
            for i, r in enumerate(reps)]
    return DoneWorkout(wid, day, started, sets)


def ctx(catalogue, today, days=(MON, WED, FRI), last_night=None, workouts=(), goal=GOAL) -> Context:
    routine = generate_routine(catalogue, list(days), 60, "gym", "maintain")
    return Context(today=today, routine=routine, sleep_goal=goal, last_night=last_night, workouts=list(workouts))


def ids(recs):
    return [r.id for r in recs]


def test_training_day_shows_the_planned_session(catalogue):
    recs = recommend(ctx(catalogue, MONDAY))
    assert ids(recs) == ["plan_for_today"]
    assert recs[0].kind == "plan" and recs[0].title.startswith("Today: Full body")
    assert recs[0].reasons == ["Monday is one of your training days"]


def test_rest_day_is_presented_as_part_of_the_plan(catalogue):
    recs = recommend(ctx(catalogue, MONDAY + dt.timedelta(days=1)))  # Tuesday
    assert recs[0].kind == "rest" and recs[0].title == "Rest day"
    assert "Next session: Wednesday" in recs[0].message


def test_missing_sleep_and_history_are_not_treated_as_bad(catalogue):
    recs = recommend(ctx(catalogue, MONDAY, last_night=None, workouts=[]))
    assert all(r.kind not in ("lighter",) for r in recs)
    assert ids(recs) == ["plan_for_today"]


def test_short_sleep_suggests_lighter_without_changing_the_plan(catalogue):
    recs = recommend(ctx(catalogue, MONDAY, last_night=night(MONDAY, 5 * 60 + 30)))
    lighter = [r for r in recs if r.id == "sleep_last_night"]
    assert lighter and lighter[0].kind == "lighter"
    assert "5 h 30 min" in lighter[0].reasons[0] and "8 h goal" in lighter[0].reasons[0]
    assert lighter[0].sources == ["Sleep you logged"]
    assert "plan hasn't changed" in lighter[0].message
    assert recs[0].id == "plan_for_today"  # the session itself is still shown


def test_slightly_short_sleep_or_rest_day_gives_no_sleep_warning(catalogue):
    assert "sleep_last_night" not in ids(recommend(ctx(catalogue, MONDAY, last_night=night(MONDAY, 7 * 60 + 30))))
    tuesday = MONDAY + dt.timedelta(days=1)
    assert "sleep_last_night" not in ids(recommend(ctx(catalogue, tuesday, last_night=night(tuesday, 4 * 60))))


def test_default_goal_wording(catalogue):
    goal = SleepGoal(minutes=7 * 60, custom=False, recommended_hours=(7, 9))
    recs = recommend(ctx(catalogue, MONDAY, last_night=night(MONDAY, 5 * 60), goal=goal))
    assert "the 7 h recommended for your age" in recs[1].reasons[0]


def test_whoop_recovery_bands(catalogue):
    low = recommend(ctx(catalogue, MONDAY, last_night=night(MONDAY, 8 * 60, "whoop", recovery=20)))
    rec = next(r for r in low if r.id == "whoop_recovery")
    assert rec.kind == "lighter" and "20%" in rec.reasons[0] and rec.sources == ["WHOOP recovery"]
    high = recommend(ctx(catalogue, MONDAY, last_night=night(MONDAY, 8 * 60, "whoop", recovery=80)))
    assert next(r for r in high if r.id == "whoop_recovery").kind == "info"
    mid = recommend(ctx(catalogue, MONDAY, last_night=night(MONDAY, 8 * 60, "whoop", recovery=50)))
    assert "whoop_recovery" not in ids(mid)


def test_missed_sessions_never_suggest_doubling_up(catalogue):
    friday = MONDAY + dt.timedelta(days=4)
    recs = recommend(ctx(catalogue, friday, workouts=[workout(MONDAY, 1, [10])]))
    missed = next(r for r in recs if r.id == "missed_sessions")
    assert missed.title == "1 of 2 planned sessions so far this week"
    assert "No need to make it up" in missed.message
    # training on another day than planned still counts
    recs = recommend(ctx(catalogue, friday, workouts=[workout(MONDAY, 1, [10]), workout(MONDAY + dt.timedelta(days=1), 1, [10], wid=2)]))
    assert "missed_sessions" not in ids(recs)


def test_already_trained_today(catalogue):
    recs = recommend(ctx(catalogue, MONDAY, last_night=night(MONDAY, 4 * 60), workouts=[workout(MONDAY, 1, [10])]))
    assert ids(recs) == ["plan_for_today"]
    assert recs[0].title == "Done for today"


def test_progression_when_top_of_range_reached(catalogue):
    c = ctx(catalogue, MONDAY)
    first = c.today_session.exercises[0]
    previous_friday = MONDAY - dt.timedelta(days=3)
    c.workouts = [workout(previous_friday, first.exercise_id, [12, 12, 12], weight=60)]
    recs = recommend(c)
    prog = next(r for r in recs if r.id == "progression")
    assert prog.title == f"Ready to progress: {first.name}"
    assert "3 sets of 12+ reps at 60 kg" in prog.reasons[0]
    # not all sets reached the top: nothing
    c.workouts = [workout(previous_friday, first.exercise_id, [12, 11, 10], weight=60)]
    assert "progression" not in ids(recommend(c))
    # never "go heavier" on a day we suggest going lighter
    c.workouts = [workout(previous_friday, first.exercise_id, [12, 12, 12], weight=60)]
    c.last_night = night(MONDAY, 4 * 60)
    assert "progression" not in ids(recommend(c))


def test_api_returns_suggestions_with_disclaimer(client, auth):
    r = client.put("/api/me/profile", json={**PROFILE, "training_days": [0, 1, 2, 3, 4, 5]}, headers=auth)
    assert r.status_code == 200
    r = client.get("/api/me/recommendations?tz_offset=120", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["disclaimer"] == DISCLAIMER
    assert body["items"][0]["id"] == "plan_for_today"
    assert all({"title", "message", "reasons", "sources", "kind"} <= set(i) for i in body["items"])
    assert client.get("/api/me/recommendations?tz_offset=5000", headers=auth).status_code == 422


def test_days_before_sign_up_are_not_missed(catalogue):
    friday = MONDAY + dt.timedelta(days=4)
    c = ctx(catalogue, friday)
    c.since = friday  # signed up today
    assert "missed_sessions" not in ids(recommend(c))
    c.since = MONDAY + dt.timedelta(days=2)  # Wednesday: only Wednesday counts
    missed = next(r for r in recommend(c) if r.id == "missed_sessions")
    assert missed.title == "0 of 1 planned session so far this week"
