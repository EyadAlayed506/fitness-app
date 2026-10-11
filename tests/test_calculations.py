from datetime import date

import pytest

from app.services import calculations as calc
from app.services.units import UnitError, to_base_amount, units_for


def test_bmi_and_category():
    assert calc.bmi(80, 180) == pytest.approx(24.69, abs=0.01)
    assert calc.bmi_category(17) == "underweight"
    assert calc.bmi_category(24.9) == "normal"
    assert calc.bmi_category(27) == "overweight"
    assert calc.bmi_category(31) == "obese"


def test_weight_for_bmi():
    assert calc.weight_for_bmi(22, 180) == pytest.approx(71.28)


def test_age_before_and_after_birthday():
    assert calc.age_on(date(2000, 6, 15), date(2026, 6, 14)) == 25
    assert calc.age_on(date(2000, 6, 15), date(2026, 6, 15)) == 26


def test_mifflin_st_jeor():
    assert calc.bmr(80, 180, 30, "male") == pytest.approx(1780)
    assert calc.bmr(60, 165, 30, "female") == pytest.approx(1320.25)
    assert calc.tdee(80, 180, 30, "male", "moderate") == pytest.approx(1780 * 1.55)


def test_resolve_direction():
    assert calc.resolve_direction("auto", 28) == "lose"
    assert calc.resolve_direction("auto", 17) == "gain"
    assert calc.resolve_direction("auto", 22) == "maintain"
    assert calc.resolve_direction("gain", 28) == "gain"


def test_diet_options_lose():
    options = calc.diet_options("lose", 2500, 1800, "male", weight_change_kg=-10)
    by_name = {o.option: o for o in options}
    assert by_name["light"].calories == 2250
    assert by_name["normal"].difference == -500
    assert by_name["normal"].weekly_change_kg == pytest.approx(-0.45, abs=0.01)
    assert by_name["normal"].weeks_to_target == pytest.approx(22.0, abs=0.1)
    # extreme would be 1500 but BMR is 1800 -> capped
    assert by_name["extreme"].calories == 1800
    assert by_name["extreme"].capped
    assert by_name["extreme"].warning


def test_diet_options_gain_and_maintain():
    gain = calc.diet_options("gain", 2000, 1400, "female", weight_change_kg=5)
    assert [o.difference for o in gain] == [250, 350, 500]
    assert all(o.weeks_to_target for o in gain)
    maintain = calc.diet_options("maintain", 2000, 1400, "female", weight_change_kg=0)
    assert len(maintain) == 1 and maintain[0].calories == 2000


def test_projection_slows_down():
    weights, reached = calc.project_weight(95, 2300, 180, 30, "male", "moderate", target_weight_kg=71.3)
    drops = [a - b for a, b in zip(weights, weights[1:])]
    assert drops[0] > drops[-1] > 0  # losing, but slower over time
    assert reached is None or weights[reached] <= 71.3


def test_navy_body_fat():
    male = calc.navy_body_fat("male", 180, waist_cm=90, neck_cm=38)
    assert male == pytest.approx(19.8, abs=0.2)
    assert calc.navy_body_fat("female", 165, waist_cm=75, neck_cm=33) is None  # needs hips
    assert calc.navy_body_fat("male", 180, waist_cm=30, neck_cm=38) is None  # invalid


def test_estimated_1rm():
    assert calc.estimated_1rm(100, 1) == 100
    assert calc.estimated_1rm(100, 10) == pytest.approx(133.33, abs=0.01)


def test_units():
    assert to_base_amount(1, "kg", is_liquid=False) == 1000
    assert to_base_amount(2, "oz", is_liquid=False) == pytest.approx(56.7, abs=0.01)
    assert to_base_amount(1, "gallon", is_liquid=True) == pytest.approx(3785.41, abs=0.01)
    assert to_base_amount(2, "serving", False, serving_size=30, serving_unit="g") == 60
    assert to_base_amount(1, "serving", True, serving_size=12, serving_unit="fl_oz") == pytest.approx(354.88, abs=0.01)
    with pytest.raises(UnitError):
        to_base_amount(100, "ml", is_liquid=False)  # liquid unit on a solid
    with pytest.raises(UnitError):
        to_base_amount(1, "serving", False)
    assert units_for(True, has_serving=True)[0] == "serving"
    assert "gallon" in units_for(True, False) and "oz" not in units_for(True, False)
