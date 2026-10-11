"""Health formulas. All are standard estimates, not medical advice."""

import math
from dataclasses import dataclass
from datetime import date

KCAL_PER_KG = 7700  # approx. energy in 1 kg of body fat

HEALTHY_BMI_LOW = 18.5
HEALTHY_BMI_HIGH = 24.9
OPTIMAL_BMI = 22.0

ACTIVITY_FACTORS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

# Daily calorie difference from TDEE for each diet option
DIET_DIFFERENCE = {
    "lose": {"light": -250, "normal": -500, "extreme": -1000},
    "gain": {"light": 250, "normal": 350, "extreme": 500},
}

MIN_CALORIES = {"female": 1200, "male": 1500}


def age_on(birth_date: date, today: date | None = None) -> int:
    today = today or date.today()
    before_birthday = (today.month, today.day) < (birth_date.month, birth_date.day)
    return today.year - birth_date.year - before_birthday


def bmi(weight_kg: float, height_cm: float) -> float:
    h = height_cm / 100
    return weight_kg / (h * h)


def bmi_category(value: float) -> str:
    if value < 18.5:
        return "underweight"
    if value < 25:
        return "normal"
    if value < 30:
        return "overweight"
    return "obese"


def weight_for_bmi(target_bmi: float, height_cm: float) -> float:
    h = height_cm / 100
    return target_bmi * h * h


def bmr(weight_kg: float, height_cm: float, age: int, sex: str) -> float:
    """Mifflin-St Jeor."""
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    return base + 5 if sex == "male" else base - 161


def tdee(weight_kg: float, height_cm: float, age: int, sex: str, activity_level: str) -> float:
    return bmr(weight_kg, height_cm, age, sex) * ACTIVITY_FACTORS[activity_level]


def navy_body_fat(
    sex: str, height_cm: float, waist_cm: float, neck_cm: float, hips_cm: float | None = None
) -> float | None:
    """U.S. Navy body-fat estimate (metric). Returns None when inputs are missing or invalid."""
    try:
        if sex == "male":
            density = 1.0324 - 0.19077 * math.log10(waist_cm - neck_cm) + 0.15456 * math.log10(height_cm)
        else:
            if hips_cm is None:
                return None
            density = (
                1.29579
                - 0.35004 * math.log10(waist_cm + hips_cm - neck_cm)
                + 0.22100 * math.log10(height_cm)
            )
    except ValueError:  # log of a non-positive number
        return None
    value = 495 / density - 450
    return round(value, 1) if 2 <= value <= 70 else None


def resolve_direction(goal: str, bmi_value: float) -> str:
    """Turn the profile goal into lose / maintain / gain. 'auto' follows the BMI."""
    if goal != "auto":
        return goal
    if bmi_value > HEALTHY_BMI_HIGH:
        return "lose"
    if bmi_value < HEALTHY_BMI_LOW:
        return "gain"
    return "maintain"


@dataclass
class DietPlanOption:
    option: str
    calories: float
    difference: float
    weekly_change_kg: float
    weeks_to_target: float | None
    capped: bool
    warning: str | None


def diet_options(
    direction: str,
    tdee_value: float,
    bmr_value: float,
    sex: str,
    weight_change_kg: float,
) -> list[DietPlanOption]:
    """Calories for light / normal / extreme. weight_change_kg: target minus current."""
    if direction == "maintain":
        return [DietPlanOption("maintain", round(tdee_value), 0, 0, None, False, None)]

    floor = max(bmr_value, MIN_CALORIES[sex])
    options = []
    for name, diff in DIET_DIFFERENCE[direction].items():
        calories = tdee_value + diff
        capped, warning = False, None
        if direction == "lose" and calories < floor:
            calories, capped = floor, True
            warning = f"Capped at {round(floor)} kcal so intake never drops below a safe minimum"
        difference = calories - tdee_value
        weekly = difference * 7 / KCAL_PER_KG
        heading_to_target = (weight_change_kg < 0 and weekly < 0) or (weight_change_kg > 0 and weekly > 0)
        weeks = abs(weight_change_kg) / abs(weekly) if heading_to_target else None
        options.append(
            DietPlanOption(
                option=name,
                calories=round(calories),
                difference=round(difference),
                weekly_change_kg=round(weekly, 2),
                weeks_to_target=round(weeks, 1) if weeks is not None else None,
                capped=capped,
                warning=warning,
            )
        )
    return options


def project_weight(
    start_weight_kg: float,
    daily_calories: float,
    height_cm: float,
    age: int,
    sex: str,
    activity_level: str,
    target_weight_kg: float,
    max_weeks: int = 104,
) -> tuple[list[float], int | None]:
    """Week-by-week weight when eating a fixed number of calories.

    TDEE is recomputed every week, so progress slows as weight changes.
    Returns (weights from week 0, week the target is reached or None).
    """
    weights = [start_weight_kg]
    losing = target_weight_kg < start_weight_kg
    reached = None
    w = start_weight_kg
    for week in range(1, max_weeks + 1):
        w += (daily_calories - tdee(w, height_cm, age, sex, activity_level)) * 7 / KCAL_PER_KG
        weights.append(round(w, 2))
        if reached is None and ((losing and w <= target_weight_kg) or (not losing and w >= target_weight_kg)):
            reached = week
            break
        if abs(weights[-1] - weights[-2]) < 0.01:  # plateau
            break
    return weights, reached


def estimated_1rm(weight_kg: float, reps: int) -> float:
    """Epley formula."""
    if reps <= 0:
        return 0.0
    if reps == 1:
        return weight_kg
    return weight_kg * (1 + reps / 30)
