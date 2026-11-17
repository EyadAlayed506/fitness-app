"""Alternatives for an exercise when its equipment isn't available, from the curated catalogue.

Only exercises in the catalogue are suggested, and only these relationships are used:
- "similar": the same movement pattern (e.g. both are squats). Differences in equipment are spelled out.
- "different": the same main muscle group but another movement. Never presented as equivalent.
"""

from dataclasses import dataclass, field

from app.i18n import Table, current_language, tr
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

# What the user reads, in the language of the request (app.i18n). IDs (patterns, muscle groups, categories)
# are translated only for display.
TEXTS: Table = {
    "en": {
        "same_movement": "Same movement ({pattern})",
        "same_muscles": "Same main muscles ({muscle})",
        "more_work_on": "Puts more of the work on the {muscle} than the {original}.",
        "different_movement": "A different movement ({pattern}), not a like-for-like swap.",
        "another_movement": "another movement",
        "eq.bodyweight": "Body weight only, so it's usually lighter than the original: use more reps or a slower tempo.",
        "eq.free_weight": "Free weight: needs more balance and control than a machine, so start lighter.",
        "eq.machine": "Machine: the path is guided, so the weight you can use will be different. Find a new working weight.",
        "eq.cable": "Cable: the resistance stays on through the whole movement, so start lighter.",
        "eq.other": "Uses a {alt} instead of a {original}, so pick a new working weight.",
        "rel.horizontal_press.incline_press": RELATED_PATTERNS[("horizontal_press", "incline_press")],
        "rel.incline_press.horizontal_press": RELATED_PATTERNS[("incline_press", "horizontal_press")],
        "rel.dip.elbow_extension": RELATED_PATTERNS[("dip", "elbow_extension")],
        "rel.elbow_extension.dip": RELATED_PATTERNS[("elbow_extension", "dip")],
    },
    "ar": {
        "same_movement": "الحركة نفسها ({pattern})",
        "same_muscles": "العضلات الرئيسية نفسها ({muscle})",
        "more_work_on": "يضع عبئاً أكبر على {muscle} مقارنة بـ{original}.",
        "different_movement": "حركة مختلفة ({pattern})، وليست بديلاً مطابقاً.",
        "another_movement": "حركة أخرى",
        "eq.bodyweight": "بوزن الجسم فقط، لذا يكون عادةً أخف من الأصلي: زِد التكرارات أو أبطئ الإيقاع.",
        "eq.free_weight": "أوزان حرة: تحتاج توازناً وتحكماً أكثر من الجهاز، فابدأ بوزن أخف.",
        "eq.machine": "جهاز: المسار موجَّه، فسيختلف الوزن الذي تستطيع استخدامه. حدّد وزن عمل جديداً.",
        "eq.cable": "كيبل: تبقى المقاومة طوال الحركة، فابدأ بوزن أخف.",
        "eq.other": "يستخدم {alt} بدلاً من {original}، فاختر وزن عمل جديداً.",
        "rel.horizontal_press.incline_press": "ضغط مائل، فيضع عبئاً أكبر على أعلى الصدر والأكتاف.",
        "rel.incline_press.horizontal_press": "ضغط مستوٍ: تركيز أقل على أعلى الصدر والأكتاف من النسخة المائلة.",
        "rel.dip.elbow_extension": "يمرّن الترايسبس دون إشراك الكتف والصدر كما في تمرين المتوازي.",
        "rel.elbow_extension.dip": "يمرّن أيضاً الصدر والأكتاف، ويضع حملاً أكبر على مفصل الكتف.",
    },
}

_AR_PATTERNS = {
    "horizontal_press": "ضغط أفقي", "incline_press": "ضغط مائل", "chest_fly": "فتح للصدر", "vertical_pull": "سحب عمودي",
    "horizontal_pull": "تجديف", "vertical_press": "ضغط فوق الرأس", "lateral_raise": "رفرفة جانبية",
    "rear_delt_fly": "فتح للكتف الخلفي", "squat": "قرفصاء", "knee_extension": "مدّ الركبة", "knee_flexion": "ثني الساق",
    "hip_hinge": "مفصلة الورك", "hip_extension": "دفع الورك / الجسر", "hip_abduction": "إبعاد الورك",
    "calf_raise": "رفع السمانة", "elbow_flexion": "ثني الذراع", "elbow_extension": "مدّ الترايسبس", "dip": "متوازي",
    "trunk_flexion": "طحن البطن", "anti_extension": "ثبات الجذع",
}
_AR_MUSCLES = {
    "chest": "الصدر", "back": "الظهر", "shoulders": "الأكتاف", "quads": "الفخذ الأمامي", "hamstrings": "الفخذ الخلفي",
    "glutes": "الأرداف", "calves": "السمانة", "biceps": "الباي", "triceps": "الترايسبس", "core": "الجذع",
}
_AR_CATEGORIES = {"machine": "جهاز", "free weight": "أوزان حرة", "cable": "كيبل", "bodyweight": "وزن الجسم"}


def _ar() -> bool:
    return current_language() == "ar"


def _pattern(pattern: str | None) -> str:
    if not pattern:
        return tr(TEXTS, "another_movement")
    if _ar() and pattern in _AR_PATTERNS:
        return _AR_PATTERNS[pattern]
    return PATTERN_LABELS.get(pattern, pattern)


def _muscle(group: str) -> str:
    return _AR_MUSCLES.get(group, group) if _ar() else group


def _category(category: str) -> str:
    return _AR_CATEGORIES.get(category, category) if _ar() else category


def _t(key: str, **params: object) -> str:
    """A text without the invisible direction marks: reasons are short lines shown on their own."""
    return tr(TEXTS, key, **params).replace("\u2068", "").replace("\u2069", "")


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
        return _t("eq.bodyweight")
    if alt.category == "free weight" and original.category in ("machine", "cable"):
        return _t("eq.free_weight")
    if alt.category == "machine" and original.category in ("free weight", "bodyweight"):
        return _t("eq.machine")
    if alt.category == "cable":
        return _t("eq.cable")
    return _t("eq.other", alt=_category(alt.category), original=_category(original.category))


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
        related = (original.pattern, ex.pattern) in RELATED_PATTERNS
        same_group = ex.muscle_group == original.muscle_group
        pattern_label = _pattern(ex.pattern)
        same_muscles = _t("same_muscles", muscle=_muscle(ex.muscle_group))
        if same_pattern:
            alt = Alternative(ex, "similar", reasons=[_t("same_movement", pattern=pattern_label)])
            if same_group:
                alt.reasons.append(same_muscles)
            else:
                alt.differences.append(_t("more_work_on", muscle=_muscle(ex.muscle_group), original=_muscle(original.muscle_group)))
        elif related and same_group:
            alt = Alternative(ex, "similar", reasons=[same_muscles], differences=[_t(f"rel.{original.pattern}.{ex.pattern}")])
        elif same_group:
            alt = Alternative(
                ex,
                "different",
                reasons=[same_muscles],
                differences=[_t("different_movement", pattern=pattern_label)],
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
