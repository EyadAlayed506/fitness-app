"""Rule-based workout routine generator."""

from dataclasses import dataclass, field

from app.models.exercise import Exercise
from app.i18n import Table, tr, tr_count, weekday_name
from app.services.schedule import (
    FOCUSES,
    DayChoice,
    cycle_order,
    day_names,
    focus_label,
    plan_warnings,
    recommend_focus,
)

# The plan's notes, in the language of the request (app.i18n)
TEXTS: Table = {
    "en": {
        "sets_note": "{sets} of {reps} reps. Each exercise has its own rest time; the rest timer starts after every set.",
        "sets": "{n} set|{n} sets",
        "cardio_note": "Finish each session with {cardio} min of cardio (bike, rower or brisk walk).",
        "progress_note": "When you hit the top of the rep range on every set, add weight next time.",
        "own_plan": "Your own plan. Recommended for these days: {split}.",
    },
    "ar": {
        "sets_note": "{sets} من {reps} تكرار. لكل تمرين وقت راحة خاص به، ويبدأ مؤقّت الراحة بعد كل مجموعة.",
        "sets": "لا مجموعات|مجموعة واحدة|مجموعتان|{n} مجموعات|{n} مجموعة|{n} مجموعة",
        "cardio_note": "اختم كل حصة بـ {cardio} د من الكارديو (دراجة، تجديف أو مشي سريع).",
        "progress_note": "عندما تصل إلى أعلى نطاق التكرارات في كل مجموعة، زِد الوزن في المرة القادمة.",
        "own_plan": "خطتك الخاصة. المقترح لهذه الأيام: {split}.",
    },
}

# Which equipment levels each profile setting may use
ALLOWED_EQUIPMENT = {
    "gym": {"gym", "home", "bodyweight"},
    "home": {"home", "bodyweight"},
    "bodyweight": {"bodyweight"},
}

# Muscle-group slots per day type, in priority order. A day with N exercises uses the first N.
DAY_TEMPLATES = {
    "Full body A": ["quads", "chest", "back", "hamstrings", "shoulders", "core", "biceps", "triceps"],
    "Full body B": ["glutes", "back", "chest", "quads", "shoulders", "core", "triceps", "calves"],
    "Upper": ["chest", "back", "shoulders", "back", "chest", "biceps", "triceps", "core"],
    "Lower": ["quads", "hamstrings", "glutes", "calves", "quads", "core", "hamstrings", "calves"],
    "Push": ["chest", "shoulders", "chest", "triceps", "shoulders", "triceps", "chest", "core"],
    "Pull": ["back", "back", "biceps", "back", "biceps", "core", "back", "biceps"],
    "Legs": ["quads", "hamstrings", "glutes", "calves", "quads", "core", "hamstrings", "calves"],
}

# Exercise template for each session type. Full-body days alternate between A and B.
FOCUS_TEMPLATES = {"upper": "Upper", "lower": "Lower", "push": "Push", "pull": "Pull", "legs": "Legs"}

REPS_BY_DIRECTION = {"lose": "10-15", "gain": "6-12", "maintain": "8-12"}
MINUTES_PER_EXERCISE = 9


@dataclass
class RoutineExercise:
    exercise_id: int
    name: str
    muscle_group: str
    sets: int
    reps: str
    rest_seconds: int


@dataclass
class RoutineDay:
    weekday: str
    weekday_index: int  # 0 = Monday ... 6 = Sunday
    title: str  # the user's own name for the day, or the session type
    focus: str  # "full_body", "upper", ... (see schedule.FOCUSES)
    focus_label: str
    recommended_focus: str
    custom_name: bool  # the title is a name the user gave the day
    exercises: list[RoutineExercise] = field(default_factory=list)
    cardio_minutes: int = 0
    custom_exercises: bool = False  # the user's own exercises (e.g. from a screenshot), not generated


@dataclass
class FocusOption:
    value: str
    label: str


@dataclass
class Routine:
    split: str
    split_reason: str
    training_days: list[int]
    rest_days: list[str]
    days_per_week: int
    minutes_per_session: int
    exercises_per_day: int
    reps: str
    days: list[RoutineDay]
    notes: list[str]
    customized: bool = False  # the user changed a session type or named a day
    recommended_split: str = ""
    warnings: list[str] = field(default_factory=list)
    focus_options: list[FocusOption] = field(default_factory=lambda: [FocusOption(k, focus_label(k)) for k in FOCUSES])


def _plain(text: str) -> str:
    """Without the invisible direction marks: notes are shown on their own."""
    return text.replace("\u2068", "").replace("\u2069", "")


def exercises_per_session(minutes: int, cardio_minutes: int = 0) -> int:
    return max(2, min(8, (minutes - cardio_minutes) // MINUTES_PER_EXERCISE))


def generate_routine(
    catalogue: list[Exercise],
    training_days: list[int],
    minutes_per_session: int,
    equipment: str,
    direction: str,
    choices: dict[int, DayChoice] | None = None,
) -> Routine:
    """`choices`: the user's own session type and/or name per weekday; the rest use the recommendation."""
    allowed = ALLOWED_EQUIPMENT[equipment]
    by_group: dict[str, list[Exercise]] = {}
    # Prefer the most specific equipment the user has (machines in a gym, dumbbells at home)
    rank = {"gym": 0, "home": 1, "bodyweight": 2}
    for ex in sorted(catalogue, key=lambda e: (rank[e.equipment], e.id or 0)):
        if ex.equipment in allowed:
            by_group.setdefault(ex.muscle_group, []).append(ex)

    cardio = 15 if direction == "lose" and minutes_per_session >= 40 else 0
    n_exercises = exercises_per_session(minutes_per_session, cardio)
    reps = REPS_BY_DIRECTION[direction]
    rest = 60 if direction == "lose" else 90
    sets = 3

    training_days = sorted(set(training_days))
    choices = {d: c for d, c in (choices or {}).items() if d in training_days}
    recommended, split_name, split_reason = recommend_focus(training_days)
    focus = {d: (choices[d].focus if d in choices and choices[d].focus else recommended[d]) for d in training_days}
    # full-body days alternate between the A and B templates, in the order the week runs
    template: dict[int, str] = {}
    full_body_count = 0
    for d in cycle_order(training_days):
        if focus[d] == "full_body":
            template[d] = "Full body A" if full_body_count % 2 == 0 else "Full body B"
            full_body_count += 1
        else:
            template[d] = FOCUS_TEMPLATES[focus[d]]
    customized = any(focus[d] != recommended[d] for d in training_days) or any(c.name for c in choices.values())
    days = []
    template_use: dict[str, int] = {}  # vary exercise choice when a day type repeats
    for weekday_index in training_days:  # calendar order, Monday first
        title = template[weekday_index]
        variant = template_use.get(title, 0)
        template_use[title] = variant + 1
        name = choices[weekday_index].name if weekday_index in choices else None
        day = RoutineDay(
            weekday=weekday_name(weekday_index),
            weekday_index=weekday_index,
            title=name or focus_label(focus[weekday_index]),
            focus=focus[weekday_index],
            focus_label=focus_label(focus[weekday_index]),
            recommended_focus=recommended[weekday_index],
            custom_name=bool(name),
            cardio_minutes=cardio,
        )
        used: set[int] = set()
        group_count: dict[str, int] = {}
        for group in DAY_TEMPLATES[title]:
            if len(day.exercises) == n_exercises:
                break
            options = [e for e in by_group.get(group, []) if e.id not in used]
            if not options:
                continue
            k = group_count.get(group, 0)
            group_count[group] = k + 1
            ex = options[(k + variant) % len(options)]
            used.add(ex.id)
            day.exercises.append(RoutineExercise(ex.id, ex.name, group, sets, reps, ex.default_rest_seconds or rest))
        days.append(day)

    notes = [_plain(tr(TEXTS, "sets_note", sets=_plain(tr_count(TEXTS, "sets", sets)), reps=reps))]
    if cardio:
        notes.append(_plain(tr(TEXTS, "cardio_note", cardio=cardio)))
    notes.append(tr(TEXTS, "progress_note"))

    if any(focus[d] != recommended[d] for d in training_days):
        your_split = " / ".join(focus_label(focus[d]) for d in cycle_order(training_days))
        your_reason = _plain(tr(TEXTS, "own_plan", split=split_name))
    else:
        your_split, your_reason = split_name, split_reason
    return Routine(
        split=your_split,
        split_reason=your_reason,
        customized=customized,
        recommended_split=split_name,
        warnings=plan_warnings(focus),
        training_days=training_days,
        rest_days=day_names(set(range(7)) - set(training_days)),
        days_per_week=len(training_days),
        minutes_per_session=minutes_per_session,
        exercises_per_day=n_exercises,
        reps=reps,
        days=days,
        notes=notes,
    )
