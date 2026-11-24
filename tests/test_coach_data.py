"""What the coach's tools hand the AI, so it quotes numbers instead of guessing them: macro targets, fiber/sugar/
sodium, a multi-day food summary, full-day averages, sleep stage averages and the Progress patterns."""

import datetime as dt
import json

from sqlmodel import select

from app.models.food import Food, FoodLog, FoodSource
from app.models.user import Profile, User
from app.services import assistant
from app.services.plan import build_plan
from tests.conftest import add_sleep, add_workout
from tests.test_assistant import TODAY, tool_ctx


def run(session, name, args=None):
    text, is_error = assistant.run_tool(tool_ctx(session), name, args or {})
    assert not is_error, text
    return json.loads(text)


def food(session, name="Test oats", **per100) -> Food:
    values = {"calories": 380, "protein_g": 13, "carbs_g": 67, "fat_g": 7, **per100}
    f = Food(name=name, source=FoodSource.manual, **values)
    session.add(f)
    session.commit()
    return f


def eat(session, f: Food, day: dt.date, grams: float, meal="breakfast"):
    user = session.exec(select(User)).one()
    session.add(FoodLog(
        user_id=user.id, food_id=f.id, date=day, meal=meal, quantity=grams, unit="g", amount_base=grams,
        calories=f.calories * grams / 100, protein_g=f.protein_g * grams / 100, carbs_g=f.carbs_g * grams / 100,
        fat_g=f.fat_g * grams / 100,
    ))
    session.commit()


def targets(session) -> dict:
    user = session.exec(select(User)).one()
    return assistant.macro_targets(build_plan(session.get(Profile, user.id)).target_calories)


def test_macro_targets_match_the_apps_macro_bars():
    assert assistant.macro_targets(2436) == {"calories": 2436, "protein_g": 183, "carbs_g": 244, "fat_g": 81}
    assert assistant.macro_targets(None) is None


def test_profile_and_food_day_carry_the_macro_targets(client, auth, session):
    assert run(session, "get_profile_and_plan")["macro_targets"] == targets(session)
    oats = food(session, fiber_g=10, sugar_g=1, saturated_fat_g=1.2, sodium_mg=6)
    yesterday = TODAY - dt.timedelta(days=1)
    eat(session, oats, yesterday, 200)
    day = run(session, "get_food_day", {"date": yesterday.isoformat()})
    t = targets(session)
    assert day["targets"] == t and day["day_is_over"] is True
    assert day["eaten_minus_target"]["protein_g"] == round(26 - t["protein_g"], 1)
    nutrients = day["other_nutrients"]
    assert (nutrients["fiber_g"], nutrients["sugar_g"], nutrients["sodium_mg"]) == (20.0, 2.0, 12)
    assert nutrients["entries_without_a_value"]["added_sugar_g"] == 1  # the food has no value: not counted as 0
    assert day["guidelines"]["sodium_mg_at_most"] == 2300


def test_calorie_trend_averages_full_days_only(client, auth, session):
    oats = food(session)
    eat(session, oats, TODAY - dt.timedelta(days=2), 500)  # 1,900 kcal
    eat(session, oats, TODAY - dt.timedelta(days=1), 600)  # 2,280 kcal
    eat(session, oats, TODAY, 100)  # today isn't over: left out
    trend = run(session, "get_calorie_trend", {"days": 4})
    full = trend["full_days"]
    assert full["days_with_food"] == 2 and full["days_without_food"] == 1
    assert full["average_per_day"]["calories"] == 2090.0
    assert full["average_minus_target"]["calories"] == round(2090 - targets(session)["calories"], 1)
    assert trend["maintenance_calories"] > trend["targets"]["calories"]


def test_food_summary_foods_eaten_most_and_meals(client, auth, session):
    oats = food(session, fiber_g=10, sodium_mg=0)
    crisps = food(session, "Test crisps", calories=540, protein_g=6, carbs_g=50, fat_g=35, fiber_g=4, sodium_mg=500)
    for back in range(1, 4):
        day = TODAY - dt.timedelta(days=back)
        eat(session, oats, day, 100)
        eat(session, crisps, day, 50, meal="snack")
    eat(session, crisps, TODAY, 400, meal="snack")  # today: not in the summary
    summary = run(session, "get_food_summary", {"days": 7})
    assert summary["to"] == str(TODAY - dt.timedelta(days=1))
    assert summary["days_with_food"] == 3 and summary["days_without_food"] == 4
    assert summary["average_per_day"]["calories"] == 650.0
    assert summary["other_nutrients_average_per_day"]["fiber_g"] == 12.0
    assert summary["other_nutrients_average_per_day"]["sodium_mg"] == 250
    first, second = summary["foods_eaten_most"]
    assert (first["times_logged"], first["days"]) == (3, 3)
    assert {first["food"], second["food"]} == {"Test oats", "Test crisps"}
    crisps_row = next(f for f in summary["foods_eaten_most"] if f["food"] == "Test crisps")
    assert crisps_row["per_100"]["sodium_mg"] == 500 and crisps_row["share_of_calories_percent"] == round(100 * 270 / 650, 1)
    assert summary["days_each_meal_was_logged"] == {"breakfast": 3, "snack": 3}
    assert summary["days_protein_target_reached"] == 0


def test_food_summary_with_nothing_logged(client, auth, session):
    summary = run(session, "get_food_summary")
    assert summary["days_with_food"] == 0 and summary["average_per_day"] == {} and summary["foods_eaten_most"] == []


def test_sleep_stage_averages_only_from_tracker_nights(client, auth, session):
    user = session.exec(select(User)).one()
    for back, deep in ((0, 60), (1, 90)):
        e = add_sleep(session, user, TODAY - dt.timedelta(days=back), 420, source="health_connect")
        e.deep_minutes, e.light_minutes, e.rem_minutes, e.awake_minutes = deep, 250, 95, 20
        session.add(e)
    manual = add_sleep(session, user, TODAY - dt.timedelta(days=2), 400)
    manual.deep_minutes = 300  # a manual night's stages are never shown
    session.add(manual)
    session.commit()
    stages = run(session, "get_sleep", {"days": 7})["stage_averages"]
    assert stages == {"nights_with_stages": 2, "light_minutes": 250, "deep_minutes": 75, "rem_minutes": 95, "awake_minutes": 20}


def test_no_stage_averages_for_manual_sleep(client, auth, session):
    add_sleep(session, session.exec(select(User)).one(), TODAY, 420)
    assert run(session, "get_sleep", {"days": 7})["stage_averages"] is None


def test_patterns_tool_gives_the_progress_patterns(client, auth, session):
    user = session.exec(select(User)).one()
    for back in range(1, 15):
        day = TODAY - dt.timedelta(days=back)
        add_sleep(session, user, day, 360 if back % 2 else 480)
        if back % 2 == 0:
            add_workout(session, user, day - dt.timedelta(days=1))
    result = run(session, "get_patterns")
    ids = [f["id"] for f in result["findings"]]
    assert "sleep_after_training" in ids
    finding = result["findings"][ids.index("sleep_after_training")]
    assert finding["strength"] in ("clear", "could be chance") and finding["groups"]
    assert "cause" in result["note"]


def test_the_reply_follows_the_questions_language_in_either_app_language(client, auth, session):
    """An Arabic question in the English app gets an Arabic answer (Flash Lite answered those in English before)."""
    from app.i18n import reset_language, set_language

    for lang in ("en", "ar"):
        token = set_language(lang)
        try:
            note = assistant._context_note(tool_ctx(session))
        finally:
            reset_language(token)
        assert "this latest message" in note and "even if earlier messages" in note and "if they wrote in Arabic" in note


def test_steps_today_so_far_full_day_average_and_last_sync(client, auth, session):
    from app.models.health import DailySteps, HealthSync, PhoneSource

    user = session.exec(select(User)).one()
    for back, steps in ((3, 6000), (1, 10000), (0, 2500)):  # 2 days ago: no data
        session.add(DailySteps(user_id=user.id, date=TODAY - dt.timedelta(days=back), steps=steps, source=PhoneSource.apple_health))
    synced_at = dt.datetime(2026, 1, 1, 14, 5, tzinfo=dt.UTC)
    session.add(HealthSync(user_id=user.id, source=PhoneSource.apple_health, last_sync_at=synced_at))
    session.commit()
    steps = run(session, "get_steps", {"days": 4})
    assert steps["steps_synced"] is True and steps["today_so_far"] == 2500
    assert [d["steps"] for d in steps["days"]] == [6000, None, 10000, 2500]  # a missing day stays null, never 0
    full = steps["full_days"]
    assert (full["days_with_steps"], full["days_without_data"], full["average_per_day"]) == (2, 1, 8000)
    assert full["best_day"]["steps"] == 10000 and full["days_at_or_above_8000"] == 1
    assert steps["source"] == "apple_health" and steps["last_sync"]["source"] == "apple_health"
    assert steps["last_sync"]["at"].startswith("2026-01-01T14:05")


def test_steps_not_synced_says_how_to_connect(client, auth, session):
    steps = run(session, "get_steps")
    assert steps["steps_synced"] is False and steps["last_sync"] is None
    assert "Apple Health" in steps["note"] and "Health Connect" in steps["note"]


def test_new_tools_are_offered_to_every_backend():
    names = {t["name"] for t in assistant.TOOL_SCHEMAS}
    assert {"get_food_summary", "get_patterns", "get_steps"} <= names
    assert "get_steps" in assistant.SYSTEM_PROMPT
    assert {t["function"]["name"] for t in assistant.OPENAI_TOOLS} == names
    assert "get_food_summary" in assistant.SYSTEM_PROMPT and "get_patterns" in assistant.SYSTEM_PROMPT
