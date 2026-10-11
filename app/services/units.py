"""Unit conversion. Everything is stored in metric: g, ml, kg, cm."""

MASS_TO_G = {
    "g": 1.0,
    "kg": 1000.0,
    "oz": 28.349523125,
    "lb": 453.59237,
}

VOLUME_TO_ML = {
    "ml": 1.0,
    "l": 1000.0,
    "tsp": 4.92892159375,
    "tbsp": 14.78676478125,
    "fl_oz": 29.5735295625,
    "cup": 236.5882365,
    "pint": 473.176473,
    "quart": 946.352946,
    "gallon": 3785.411784,
}

BODY_WEIGHT_TO_KG = {"kg": 1.0, "lb": 0.45359237}
LENGTH_TO_CM = {"cm": 1.0, "in": 2.54}

SERVING = "serving"


class UnitError(ValueError):
    pass


def to_kg(value: float, unit: str) -> float:
    return value * BODY_WEIGHT_TO_KG[unit]


def to_cm(value: float, unit: str) -> float:
    return value * LENGTH_TO_CM[unit]


def units_for(is_liquid: bool, has_serving: bool) -> list[str]:
    """The units a food can be logged in."""
    units = list(VOLUME_TO_ML if is_liquid else MASS_TO_G)
    if has_serving:
        units.insert(0, SERVING)
    return units


def to_base_amount(
    quantity: float,
    unit: str,
    is_liquid: bool,
    serving_size: float | None = None,
    serving_unit: str | None = None,
) -> float:
    """Convert a logged quantity to grams (solids) or millilitres (liquids)."""
    if unit == SERVING:
        if not serving_size or not serving_unit:
            raise UnitError("This food has no serving size; use a weight or volume unit")
        return quantity * to_base_amount(serving_size, serving_unit, is_liquid)

    table = VOLUME_TO_ML if is_liquid else MASS_TO_G
    if unit not in table:
        kind = "liquid" if is_liquid else "solid"
        allowed = ", ".join(units_for(is_liquid, bool(serving_size)))
        raise UnitError(f"'{unit}' is not a valid unit for a {kind} food. Use one of: {allowed}")
    return quantity * table[unit]
