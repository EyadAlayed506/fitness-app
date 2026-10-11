"""Rule-based workout routine generator."""

from dataclasses import dataclass, field

from app.models.exercise import Exercise
from app.services.schedule import WEEKDAY_NAMES, choose_split, day_names

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
    title: str
    exercises: list[RoutineExercise] = field(default_factory=list)
    cardio_minutes: int = 0


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


def exercises_per_session(minutes: int, cardio_minutes: int = 0) -> int:
    return max(2, min(8, (minutes - cardio_minutes) // MINUTES_PER_EXERCISE))


def generate_routine(
    catalogue: list[Exercise],
    training_days: list[int],
    minutes_per_session: int,
    equipment: str,
    direction: str,
) -> Routine:
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
    titles, split_name, split_reason = choose_split(training_days)
    days = []
    template_use: dict[str, int] = {}  # vary exercise choice when a day type repeats
    for weekday_index in training_days:  # calendar order, Monday first
        title = titles[weekday_index]
        variant = template_use.get(title, 0)
        template_use[title] = variant + 1
        day = RoutineDay(weekday=WEEKDAY_NAMES[weekday_index], weekday_index=weekday_index, title=title, cardio_minutes=cardio)
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
            day.exercises.append(RoutineExercise(ex.id, ex.name, group, sets, reps, rest))
        days.append(day)

    notes = [f"{sets} sets of {reps} reps, rest {rest} s between sets."]
    if cardio:
        notes.append(f"Finish each session with {cardio} min of cardio (bike, rower or brisk walk).")
    notes.append("When you hit the top of the rep range on every set, add weight next time.")

    return Routine(
        split=split_name,
        split_reason=split_reason,
        training_days=training_days,
        rest_days=day_names(set(range(7)) - set(training_days)),
        days_per_week=len(training_days),
        minutes_per_session=minutes_per_session,
        exercises_per_day=n_exercises,
        reps=reps,
        days=days,
        notes=notes,
    )
