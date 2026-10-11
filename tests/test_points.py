import datetime as dt

import pytest
from sqlmodel import select

from app.models.food import Food, FoodLog
from app.models.points import PointAward
from app.models.user import Profile, User, WeightEntry
from app.services.activity import week_start
from app.services.plan import build_plan
from app.services.points import RULES, level_for
from tests.conftest import PROFILE, add_sleep, add_workout

TODAY = dt.date.today()
UTC_NOON = dt.time(12, tzinfo=dt.UTC)


@pytest.fixture
def user(client, auth, session) -> User:
    """A user who signed up three weeks ago and trains twice a week."""
    r = client.put("/api/me/profile", json={**PROFILE, "training_days": [0, 3]}, headers=auth)
    assert r.status_code == 200
    clear_weigh_ins(session)  # saving the profile records a weigh-in; start these tests from nothing
    u = session.exec(select(User)).one()
    u.created_at = dt.datetime.now(dt.UTC) - dt.timedelta(days=21)
    session.add(u)
    session.commit()
    return u


def clear_weigh_ins(session):
    for w in session.exec(select(WeightEntry)).all():
        session.delete(w)
    session.commit()


def points(client, auth):
    r = client.get("/api/points", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def test_nothing_logged_means_no_points_and_no_penalty(client, auth, user):
    body = points(client, auth)
    assert body["total"] == 0 and body["level"] == 1
    assert body["today"]["points"] == 0 and body["recent"] == []
    assert {r["id"] for r in body["rules"]} == set(RULES)
    assert not any(a["earned"] for a in body["achievements"])


def test_points_are_given_once_however_often_checked(client, auth, user, session):
    add_workout(session, user, TODAY)
    add_sleep(session, user, TODAY, 8 * 60)
    first = points(client, auth)
    assert first["total"] == RULES["workout"].points + RULES["sleep_goal"].points
    assert first["today"]["points"] == first["total"]
    reasons = {a["rule"]: a for a in first["today"]["awards"]}
    assert reasons["sleep_goal"]["reason"] == "Slept 8 h (goal 7 h)"
    assert reasons["workout"]["reason"] == "Finished a workout"
    assert len(first["new"]) == 2
    again = points(client, auth)
    assert again["total"] == first["total"] and again["new"] == []
    assert len(session.exec(select(PointAward)).all()) == 2


def test_extra_workouts_earn_nothing_more(client, auth, user, session):
    monday = week_start(TODAY) - dt.timedelta(days=7)  # last full week
    for d in range(4):  # four workouts on a two-days-a-week plan
        add_workout(session, user, monday + dt.timedelta(days=d))
    add_workout(session, user, monday)  # and a second one the same day
    body = points(client, auth)
    rules = [a["rule"] for a in body["recent"]]
    assert rules.count("workout") == 2
    assert rules.count("full_week") == 1
    assert body["total"] == 2 * RULES["workout"].points + RULES["full_week"].points


def test_points_are_never_taken_away(client, auth, user, session):
    w = add_workout(session, user, TODAY)
    total = points(client, auth)["total"]
    session.delete(w)
    session.commit()
    assert points(client, auth)["total"] == total


def test_short_sleep_or_late_manual_logs_earn_nothing(client, auth, user, session):
    add_sleep(session, user, TODAY - dt.timedelta(days=1), 6 * 60)  # under the 7 h goal
    add_sleep(session, user, TODAY - dt.timedelta(days=9), 8 * 60, logged_on=TODAY)  # logged a week later
    assert points(client, auth)["total"] == 0


def test_tracker_and_manual_data_are_labelled(client, auth, user, session):
    add_sleep(session, user, TODAY, 8 * 60, source="whoop")
    add_sleep(session, user, TODAY - dt.timedelta(days=1), 8 * 60)
    sources = {a["day"]: a["data_source"] for a in points(client, auth)["recent"]}
    assert sources[str(TODAY)] == "whoop"
    assert sources[str(TODAY - dt.timedelta(days=1))] == "manual"


def test_eating_to_plan_counts_only_finished_days(client, auth, user, session):
    food = session.exec(select(Food)).first()
    target = build_plan(session.get(Profile, user.id)).target_calories
    for day in (TODAY - dt.timedelta(days=1), TODAY):
        for _ in range(2):
            session.add(FoodLog(user_id=user.id, food_id=food.id, date=day, meal="lunch", quantity=1, unit="g",
                                amount_base=1, calories=target / 2, protein_g=0, carbs_g=0, fat_g=0,
                                created_at=dt.datetime.combine(day, UTC_NOON)))
    session.commit()
    awards = [a for a in points(client, auth)["recent"] if a["rule"] == "nutrition"]
    assert [a["day"] for a in awards] == [str(TODAY - dt.timedelta(days=1))]


def test_days_before_signup_never_count(client, auth, session):
    client.put("/api/me/profile", json={**PROFILE, "training_days": [0, 3]}, headers=auth)
    clear_weigh_ins(session)
    u = session.exec(select(User)).one()  # signed up just now
    add_sleep(session, u, TODAY - dt.timedelta(days=3), 8 * 60)
    add_workout(session, u, TODAY - dt.timedelta(days=3))
    assert points(client, auth)["total"] == 0


def test_weekly_weigh_in(client, auth, user):
    for _ in range(2):  # twice in a week: points once
        assert client.post("/api/me/weight", json={"weight": 94}, headers=auth).status_code == 201
    awards = [a for a in points(client, auth)["recent"] if a["rule"] == "weigh_in"]
    assert len(awards) == 1 and awards[0]["points"] == RULES["weigh_in"].points


def test_levels():
    assert level_for(0) == (1, 0, 100)
    assert level_for(99) == (1, 0, 100)
    assert level_for(100) == (2, 100, 300)
    assert level_for(650) == (4, 600, 1000)
