"""Fill the database with a demo account so every screen has data to show.

Run:  uv run python -m app.demo
Then log in with  demo@fitness.app / demo1234
Running it again resets the demo account.
"""

import random
from datetime import UTC, date, datetime, time, timedelta

from sqlmodel import Session, select

from app.database import create_db_and_tables, engine
from app.models.exercise import Exercise
from app.models.food import Food, FoodLog, FoodSource, Meal
from app.models.measurement import BodyMeasurement
from app.models.user import Profile, User, WeightEntry
from app.models.workout import WorkoutSession, WorkoutSet
from app.security import hash_password
from app.seed import seed_catalogue
from app.services.accounts import delete_user
from app.services.calculations import navy_body_fat
from app.services.plan import build_plan
from app.services.routine import generate_routine
from app.services.units import to_base_amount

EMAIL = "demo@fitness.app"
PASSWORD = "demo1234"
DAYS = 70  # ten weeks of history
START_WEIGHT = 97.0
WEEKLY_LOSS = 0.55

STARTING_WEIGHTS = {  # kg for the first week; bodyweight exercises stay at 0
    "Chest Press": 50, "Barbell Bench Press": 60, "Incline Chest Press": 40, "Pec Deck": 35, "Cable Crossover": 15,
    "Lat Pulldown": 50, "Seated Cable Row": 50, "Chest-Supported Row Machine": 45, "Assisted Pull-up Machine": 30,
    "Shoulder Press Machine": 35, "Lateral Raise Machine": 20, "Reverse Pec Deck": 25,
    "Leg Press": 140, "Leg Extension": 45, "Hack Squat": 70, "Barbell Back Squat": 70,
    "Seated Leg Curl": 40, "Lying Leg Curl": 35, "Hip Thrust Machine": 80, "Hip Abduction Machine": 50,
    "Seated Calf Raise": 40, "Biceps Curl Machine": 25, "Cable Curl": 20, "Triceps Pushdown": 25,
    "Triceps Dip Machine": 50, "Ab Crunch Machine": 35, "Cable Crunch": 30,
}

MEALS = {
    Meal.breakfast: [("Oats, rolled, dry", 60, "g"), ("Milk, skim", 1, "cup"), ("Banana", 1, "serving")],
    Meal.lunch: [("Chicken breast, roasted, skinless", 160, "g"), ("White rice, cooked", 220, "g"), ("Broccoli, cooked", 150, "g")],
    Meal.dinner: [("Salmon, cooked", 150, "g"), ("Sweet potato, baked", 220, "g"), ("Avocado", 1, "serving")],
    Meal.snack: [("Greek yogurt, plain, nonfat", 1, "serving"), ("Almonds", 30, "g")],
}
EXTRAS = [("Pita bread, white", 1, "serving", Meal.lunch), ("Hummus", 60, "g", Meal.lunch),
          ("Dates, Medjool", 3, "serving", Meal.snack), ("Cola soft drink", 330, "ml", Meal.dinner),
          ("Peanut butter", 1, "serving", Meal.breakfast), ("Egg, whole, large", 2, "serving", Meal.breakfast)]


def main() -> None:
    rng = random.Random(7)
    create_db_and_tables()
    with Session(engine) as session:
        seed_catalogue(session)
        old = session.exec(select(User).where(User.email == EMAIL)).first()
        if old:
            delete_user(session, old)

        user = User(email=EMAIL, hashed_password=hash_password(PASSWORD))
        session.add(user)
        session.commit()
        session.refresh(user)

        today = date.today()
        start = today - timedelta(days=DAYS)

        # Weigh-ins: steady loss with day-to-day noise (water, salt...)
        weights = {}
        for i in range(DAYS + 1):
            day = start + timedelta(days=i)
            if i not in (0, DAYS) and rng.random() < 0.25:
                continue  # skipped a day
            w = START_WEIGHT - WEEKLY_LOSS * i / 7 + rng.uniform(-0.45, 0.45)
            weights[day] = round(w, 1)
            session.add(WeightEntry(user_id=user.id, date=day, weight_kg=round(w, 1)))

        profile = Profile(
            user_id=user.id, birth_date=date(1995, 3, 14), sex="male", height_cm=180, weight_kg=weights[today],
            activity_level="moderate", goal="auto", diet_option="normal", days_per_week=4,
            minutes_per_session=60, equipment="gym", unit_system="metric",
        )
        session.add(profile)
        session.commit()

        # Food log for the last three weeks
        foods = {f.name: f for f in session.exec(select(Food).where(Food.source == FoodSource.builtin)).all()}
        for i in range(21, -1, -1):
            day = today - timedelta(days=i)
            if i == 0:
                plan_meals = [Meal.breakfast, Meal.lunch]  # today is still going
            else:
                plan_meals = list(MEALS)
            for meal in plan_meals:
                factor = rng.uniform(0.9, 1.3)
                for name, qty, unit in MEALS[meal]:
                    q = round(qty * factor) if unit == "g" else qty
                    add_food_log(session, user.id, foods[name], day, meal, q, unit)
            if i and rng.random() < 0.6:
                name, qty, unit, meal = rng.choice(EXTRAS)
                add_food_log(session, user.id, foods[name], day, meal, qty, unit)

        # Workouts: follow the generated routine on its weekdays
        catalogue = list(session.exec(select(Exercise)).all())
        routine = generate_routine(catalogue, 4, 60, "gym", build_plan(profile).direction)
        weekday_index = {"Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3, "Friday": 4, "Saturday": 5}
        by_weekday = {weekday_index[d.weekday]: d for d in routine.days}
        names = {e.id: e for e in catalogue}
        for i in range(DAYS, 0, -1):
            day = today - timedelta(days=i)
            plan_day = by_weekday.get(day.weekday())
            if plan_day is None or rng.random() < 0.1:
                continue
            week = (DAYS - i) / 7
            started = datetime.combine(day, time(17, rng.randint(0, 50)), tzinfo=UTC)
            workout = WorkoutSession(user_id=user.id, started_at=started,
                                     ended_at=started + timedelta(minutes=rng.randint(52, 70)))
            session.add(workout)
            session.commit()
            session.refresh(workout)
            for x in plan_day.exercises:
                ex = names[x.exercise_id]
                base = STARTING_WEIGHTS.get(ex.name, 0 if ex.equipment == "bodyweight" else 20)
                weight = round(base * (1 + 0.02 * week) / 2.5) * 2.5  # ~2% stronger per week
                for n in range(1, 4):
                    reps = max(6, 13 - n - rng.randint(0, 2))
                    session.add(WorkoutSet(session_id=workout.id, exercise_id=ex.id, set_number=n, reps=reps,
                                           weight_kg=weight, rest_seconds=60, added_via="qr" if rng.random() < 0.4 else "name"))
            session.commit()

        # Body measurements roughly once a month
        for days_ago, waist, neck, shoulders, chest, hips, arm, thigh in [
            (DAYS, 101.0, 41.0, 120.0, 108.0, 106.0, 36.0, 62.0),
            (DAYS - 30, 98.5, 40.5, 120.5, 107.0, 104.5, 36.3, 61.4),
            (9, 95.5, 40.0, 121.0, 106.0, 103.0, 36.6, 60.8),
        ]:
            m = BodyMeasurement(user_id=user.id, date=today - timedelta(days=days_ago), waist_cm=waist, neck_cm=neck,
                                shoulders_cm=shoulders, chest_cm=chest, hips_cm=hips, arm_cm=arm, thigh_cm=thigh)
            m.body_fat_pct = navy_body_fat("male", 180, waist, neck)
            session.add(m)
        session.commit()

    print(f"Demo account ready. Log in with {EMAIL} / {PASSWORD}")


def add_food_log(session: Session, user_id: int, food: Food, day: date, meal: Meal, quantity: float, unit: str) -> None:
    amount = to_base_amount(quantity, unit, food.is_liquid, food.serving_size, food.serving_unit)
    f = amount / 100
    session.add(FoodLog(
        user_id=user_id, food_id=food.id, date=day, meal=meal, quantity=quantity, unit=unit, amount_base=round(amount, 1),
        calories=round(food.calories * f, 1), protein_g=round(food.protein_g * f, 1),
        carbs_g=round(food.carbs_g * f, 1), fat_g=round(food.fat_g * f, 1),
        created_at=datetime.combine(day, time(8 + list(Meal).index(meal) * 4), tzinfo=UTC),
    ))


if __name__ == "__main__":
    main()
