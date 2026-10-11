"""Alternatives for an exercise when its equipment isn't available, from the curated catalogue.

Only exercises in the catalogue are suggested, and only these relationships are used:
- "similar": the same movement pattern (e.g. both are squats). Differences in equipment are spelled out.
- "different": the same main muscle group but another movement. Never presented as equivalent.
"""

from dataclasses import dataclass, field

from app.models.exercise import Exercise
from app.services.routine import ALLOWED_EQUIPMENT

PATTERN_LABELS = {
    "horizontal_press": "horizontal press",
    "incline_press": "incline press",
    "chest_fly": "chest fly",
    "vertical_pull": "vertical pull",
    "horizontal_pull": "row",
    "vertical_press": "overhead press",
    "lateral_raise": "lateral raise",
    "rear_delt_fly": "rear-shoulder fly",
    "squat": "squat",
    "knee_extension": "knee extension",
    "knee_flexion": "leg curl",
    "hip_hinge": "hip hinge",
    "hip_extension": "hip thrust / bridge",
    "hip_abduction": "hip abduction",
    "calf_raise": "calf raise",
    "elbow_flexion": "curl",
    "elbow_extension": "triceps extension",
    "dip": "dip",
    "trunk_flexion": "crunch",
    "anti_extension": "core hold",
}

# Patterns that are close enough to stand in for each other, with the difference explained
RELATED_PATTERNS = {
    ("horizontal_press", "incline_press"): "Pressed at an incline, so it puts more work on the upper chest and shoulders.",
    ("incline_press", "horizontal_press"): "A flat press: less upper-chest and shoulder emphasis than the incline version.",
    ("dip", "elbow_extension"): "Trains the triceps without the shoulder and chest involvement of a dip.",
    ("elbow_extension", "dip"): "Also works the chest and shoulders, and loads the shoulder joint more.",
}

MAX_PER_KIND = 3


@dataclass
class Alternative:
    exercise: Exercise
    match: str  # "similar" or "different"
    reasons: list[str] = field(default_factory=list)
    differences: list[str] = field(default_factory=list)


def _equipment_note(original: Exercise, alt: Exercise) -> str | None:
    if alt.category == original.category:
        return None
    if alt.category == "bodyweight":
        return "Body weight only, so it's usually lighter than the original: use more reps or a slower tempo."
    if alt.category == "free weight" and original.category in ("machine", "cable"):
        return "Free weight: needs more balance and control than a machine, so start lighter."
    if alt.category == "machine" and original.category in ("free weight", "bodyweight"):
        return "Machine: the path is guided, so the weight you can use will be different. Find a new working weight."
    if alt.category == "cable":
        return "Cable: the resistance stays on through the whole movement, so start lighter."
    return f"Uses a {alt.category} instead of a {original.category}, so pick a new working weight."


def find_alternatives(
    original: Exercise, catalogue: list[Exercise], equipment: str | None, include_all_equipment: bool = False
) -> list[Alternative]:
    """Alternatives from the catalogue, best first. Filtered to the user's equipment unless asked not to."""
    allowed = ALLOWED_EQUIPMENT.get(equipment or "gym", ALLOWED_EQUIPMENT["gym"])
    rank = {"gym": 0, "home": 1, "bodyweight": 2}
    similar, different = [], []
    for ex in catalogue:
        if ex.id == original.id or (not include_all_equipment and ex.equipment not in allowed):
            continue
        same_pattern = bool(original.pattern) and ex.pattern == original.pattern
        related = RELATED_PATTERNS.get((original.pattern, ex.pattern))
        same_group = ex.muscle_group == original.muscle_group
        pattern_label = PATTERN_LABELS.get(ex.pattern or "", ex.pattern or "another movement")
        if same_pattern:
            alt = Alternative(ex, "similar", reasons=[f"Same movement ({pattern_label})"])
            if same_group:
                alt.reasons.append(f"Same main muscles ({ex.muscle_group})")
            else:
                alt.differences.append(f"Puts more of the work on the {ex.muscle_group} than the {original.muscle_group}.")
        elif related and same_group:
            alt = Alternative(ex, "similar", reasons=[f"Same main muscles ({ex.muscle_group})"], differences=[related])
        elif same_group:
            alt = Alternative(
                ex,
                "different",
                reasons=[f"Same main muscles ({ex.muscle_group})"],
                differences=[f"A different movement ({pattern_label}), not a like-for-like swap."],
            )
        else:
            continue
        note = _equipment_note(original, ex)
        if note:
            alt.differences.append(note)
        (similar if alt.match == "similar" else different).append(alt)

    def order(a: Alternative):
        # same movement and muscles first, then the most specific equipment the user has (like the routine generator)
        return (
            a.exercise.pattern != original.pattern,
            a.exercise.muscle_group != original.muscle_group,
            rank.get(a.exercise.equipment, 3),
            a.exercise.name,
        )

    return sorted(similar, key=order)[:MAX_PER_KIND] + sorted(different, key=order)[:MAX_PER_KIND]
