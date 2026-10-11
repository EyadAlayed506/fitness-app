"""Builds the health plan (BMI, target weight, calories, diet options) from a profile."""

from pydantic import BaseModel

from app.models.user import Profile
from app.services import calculations as calc


class DietOptionOut(BaseModel):
    option: str
    calories: float
    difference: float
    weekly_change_kg: float
    weeks_to_target: float | None
    capped: bool
    warning: str | None
    selected: bool


class PlanOut(BaseModel):
    age: int
    weight_kg: float
    height_cm: float
    bmi: float
    bmi_category: str
    healthy_weight_min_kg: float
    healthy_weight_max_kg: float
    optimal_weight_kg: float
    weight_change_kg: float  # to optimal BMI; negative = lose
    change_to_healthy_range_kg: float  # smallest change to reach the healthy range
    direction: str  # lose / maintain / gain
    bmr: float
    tdee: float
    options: list[DietOptionOut]
    target_calories: float
    disclaimer: str = "Estimates based on standard formulas, not medical advice."


def build_plan(profile: Profile) -> PlanOut:
    age = calc.age_on(profile.birth_date)
    w, h = profile.weight_kg, profile.height_cm
    bmi_value = calc.bmi(w, h)
    low = calc.weight_for_bmi(calc.HEALTHY_BMI_LOW, h)
    high = calc.weight_for_bmi(calc.HEALTHY_BMI_HIGH, h)
    optimal = calc.weight_for_bmi(calc.OPTIMAL_BMI, h)
    to_range = low - w if w < low else high - w if w > high else 0.0

    direction = calc.resolve_direction(profile.goal, bmi_value)
    bmr_value = calc.bmr(w, h, age, profile.sex)
    tdee_value = calc.tdee(w, h, age, profile.sex, profile.activity_level)
    raw = calc.diet_options(direction, tdee_value, bmr_value, profile.sex, optimal - w)

    selected_name = "maintain" if direction == "maintain" else profile.diet_option
    options = [DietOptionOut(**o.__dict__, selected=o.option == selected_name) for o in raw]
    target = next(o.calories for o in options if o.selected)

    return PlanOut(
        age=age,
        weight_kg=round(w, 1),
        height_cm=round(h, 1),
        bmi=round(bmi_value, 1),
        bmi_category=calc.bmi_category(bmi_value),
        healthy_weight_min_kg=round(low, 1),
        healthy_weight_max_kg=round(high, 1),
        optimal_weight_kg=round(optimal, 1),
        weight_change_kg=round(optimal - w, 1),
        change_to_healthy_range_kg=round(to_range, 1),
        direction=direction,
        bmr=round(bmr_value),
        tdee=round(tdee_value),
        options=options,
        target_calories=target,
    )
