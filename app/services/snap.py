"""Snap and say: what the vision model reads from a workout screenshot, a weight, or a menu.

Every answer is checked: exercises must exist in the catalogue, numbers must be in a sensible range, and
the app always shows the result for the user to confirm or correct.
"""

import re

from app.models.exercise import Exercise
from app.services.recognition import Recognizer

# ---------- workout screenshot ----------

SCREENSHOT_PROMPT = """This is a screenshot or photo of a workout, for example from Instagram or TikTok.

Read every exercise in it, in order, with its sets and reps as written ("reps" can be a range like "8-12" or a time like "30 s"). For each exercise, pick the exercise from the list below that is the same movement and give its id; use null if nothing on the list matches. Give the workout's title if it has one.

Exercises (id: name):
{catalogue}"""

SCREENSHOT_FORMAT = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "exercises": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "exercise_id": {"type": ["integer", "null"]},
                    "sets": {"type": ["integer", "null"]},
                    "reps": {"type": ["string", "null"]},
                    "confidence": {"type": "number"},
                },
                "required": ["text", "exercise_id", "sets", "reps", "confidence"],
            },
        },
    },
    "required": ["title", "exercises"],
}

MAX_ITEMS = 15


def clean_reps(value: object, default: str) -> str:
    """"8-12", "10", "30 s"; anything else becomes the default."""
    text = str(value or "").strip().lower().replace("–", "-").replace("reps", "").strip()
    text = re.sub(r"\s*-\s*", "-", text)
    m = re.fullmatch(r"(\d{1,3})(?:-(\d{1,3}))?(\s*(?:s|sec|secs|seconds))?", text)
    if not m:
        return default
    low, high, secs = m.group(1), m.group(2), m.group(3)
    reps = f"{low}-{high}" if high else low
    return f"{reps} s" if secs else reps


def read_screenshot(recognizer: Recognizer, image: bytes, catalogue: list[Exercise], default_reps: str):
    listing = "\n".join(f"{e.id}: {e.name}" for e in catalogue)
    answer = recognizer.ask(image, SCREENSHOT_PROMPT.format(catalogue=listing), SCREENSHOT_FORMAT)
    by_id = {e.id: e for e in catalogue}
    items = []
    for raw in (answer.get("exercises") or [])[:MAX_ITEMS]:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()[:80]
        try:
            ex = by_id.get(int(raw.get("exercise_id"))) if raw.get("exercise_id") is not None else None
        except (TypeError, ValueError):
            ex = None
        if not text and ex is None:
            continue
        try:
            sets = min(10, max(1, int(raw.get("sets") or 3)))
        except (TypeError, ValueError):
            sets = 3
        try:
            confidence = max(0.0, min(1.0, float(raw.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0.0
        items.append({"text": text or ex.name, "exercise": ex, "sets": sets,
                      "reps": clean_reps(raw.get("reps"), default_reps), "confidence": round(confidence, 2)})
    return str(answer.get("title") or "").strip()[:60], items


# ---------- the weight on a machine or bar ----------

WEIGHT_PROMPT = """This photo shows the weight a lifter is about to use: the pin in a machine's weight stack, a loaded barbell, or a dumbbell.

Read the weight:
- Weight stack: the number printed on the plate the pin is in.
- Barbell: add up the plates on both sides from the numbers or colours you can see, plus the bar (20 kg or 45 lb unless you can see otherwise).
- Dumbbell: the number on it.
Give the unit if it is printed or obvious. In "details", say what you read, e.g. "pin in the plate marked 45". If you can't tell, give null for the weight."""

WEIGHT_FORMAT = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["pin_stack", "barbell", "dumbbell", "other"]},
        "weight": {"type": ["number", "null"]},
        "unit": {"type": ["string", "null"]},
        "details": {"type": "string"},
        "confidence": {"type": "number"},
    },
    "required": ["kind", "weight", "unit", "details", "confidence"],
}


def read_weight(recognizer: Recognizer, image: bytes) -> dict:
    answer = recognizer.ask(image, WEIGHT_PROMPT, WEIGHT_FORMAT)
    kind = answer.get("kind") if answer.get("kind") in ("pin_stack", "barbell", "dumbbell", "other") else "other"
    try:
        weight = float(answer["weight"]) if answer.get("weight") is not None else None
    except (TypeError, ValueError):
        weight = None
    if weight is not None and not 0 < weight <= 1000:
        weight = None  # not a weight anyone lifts
    unit = str(answer.get("unit") or "").lower().strip()
    unit = "lb" if unit in ("lb", "lbs", "pound", "pounds") else "kg" if unit in ("kg", "kgs", "kilo", "kilos") else None
    try:
        confidence = max(0.0, min(1.0, float(answer.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "kind": kind,
        "weight": round(weight, 1) if weight is not None else None,
        "unit": unit,
        "details": str(answer.get("details") or "")[:160],
        "confidence": round(confidence, 2) if weight is not None else 0.0,
    }


# ---------- restaurant menu ----------

MENU_PROMPT = """This is a photo of a restaurant menu.

List every dish you can read (up to 25), with a short description if the menu has one. For each, estimate the calories, and the protein, carbs and fat in grams, of one normal restaurant portion, from its name and description. These are rough estimates; never leave a number out. In "seen", describe the menu in a few words."""

MENU_FORMAT = {
    "type": "object",
    "properties": {
        "seen": {"type": "string"},
        "dishes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "calories": {"type": "number"},
                    "protein_g": {"type": "number"},
                    "carbs_g": {"type": "number"},
                    "fat_g": {"type": "number"},
                },
                "required": ["name", "description", "calories", "protein_g", "carbs_g", "fat_g"],
            },
        },
    },
    "required": ["seen", "dishes"],
}

MAX_DISHES = 25


def _num(value: object, high: float) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return round(v, 1) if 0 <= v <= high else None


def read_menu(recognizer: Recognizer, image: bytes) -> tuple[list[dict], str]:
    answer = recognizer.ask(image, MENU_PROMPT, MENU_FORMAT)
    dishes = []
    for raw in (answer.get("dishes") or [])[:MAX_DISHES]:
        if not isinstance(raw, dict) or not str(raw.get("name") or "").strip():
            continue
        values = {k: _num(raw.get(k), high) for k, high in
                  (("calories", 5000), ("protein_g", 500), ("carbs_g", 1000), ("fat_g", 500))}
        if values["calories"] is None:
            continue  # without calories it can't be ranked or logged
        dishes.append({
            "name": str(raw["name"]).strip()[:120],
            "description": str(raw.get("description") or "").strip()[:200],
            **{k: (v if v is not None else 0.0) for k, v in values.items()},
        })
    return dishes, str(answer.get("seen") or "")[:200]


def rank_dishes(dishes: list[dict], remaining_kcal: float, remaining_protein: float, daily_target: float) -> list[dict]:
    """How well each dish fits what's left of today. Best fit first.

    - Calories: a meal budget of about 35% of the day (or what's left, if less). Within it is fine; over it
      scores lower the further over it is, and over what's left today scores much lower.
    - Protein: more protein per calorie, and enough of it for this meal, score higher.
    - Already at today's target: the smaller the dish, the better.
    """
    meal_protein = max(20.0, remaining_protein * 0.4)
    budget = min(max(remaining_kcal, 0.0), 0.35 * daily_target)
    ranked = []
    for d in dishes:
        kcal, protein = d["calories"], d["protein_g"]
        density = min(1.0, (protein / kcal * 100) / 8) if kcal > 0 else 0.0  # 8 g protein per 100 kcal is excellent
        amount = min(1.0, protein / meal_protein)
        if remaining_kcal <= 0:
            fit = 0.8 * max(0.0, 1 - kcal / 1000) + 0.2 * density
            verdict = f"You're at today's target; about {round(kcal)} kcal"
        else:
            calorie_fit = 1.0 if kcal <= budget else max(0.0, 1 - 2 * (kcal - budget) / budget)
            if kcal > remaining_kcal:
                calorie_fit *= 0.4
            fit = 0.5 * calorie_fit + 0.25 * density + 0.25 * amount
            if kcal > budget:
                fit = min(fit, 0.65)  # more than a usual meal is never a "good fit", however much protein it has
            if kcal > remaining_kcal:
                verdict = f"About {round(kcal)} kcal: more than the {round(remaining_kcal)} left today"
            elif kcal > budget:
                verdict = f"About {round(kcal)} kcal: a big meal, {round(kcal / remaining_kcal * 100)}% of the {round(remaining_kcal)} left today"
            else:
                verdict = f"About {round(kcal)} of your {round(remaining_kcal)} kcal left, {round(protein)} g protein"
        ranked.append({**d, "fit": round(fit, 2), "verdict": verdict})
    ranked.sort(key=lambda d: -d["fit"])
    return ranked
