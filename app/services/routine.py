"""Rule-based workout routine generator."""

from dataclasses import dataclass, field

from app.models.exercise import Exercise

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

SPLITS = {
    1: ["Full body A"],
    2: ["Full body A", "Full body B"],
    3: ["Full body A", "Full body B", "Full body A"],
    4: ["Upper", "Lower", "Upper", "Lower"],
    5: ["Upper", "Lower", "Push", "Pull", "Legs"],
    6: ["Push", "Pull", "Legs", "Push", "Pull", "Legs"],
}

SPLIT_NAMES = {
    1: "Full body",
    2: "Full body A / B",
    3: "Full body A / B / A",
    4: "Upper / Lower",
    5: "Upper / Lower / Push / Pull / Legs",
    6: "Push / Pull / Legs x2",
}

WEEKDAYS = {
    1: ["Monday"],
    2: ["Monday", "Thursday"],
    3: ["Monday", "Wednesday", "Friday"],
    4: ["Monday", "Tuesday", "Thursday", "Friday"],
    5: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    6: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
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
    title: str
    exercises: list[RoutineExercise] = field(default_factory=list)
    cardio_minutes: int = 0


@dataclass
class Routine:
    split: str
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
    days_per_week: int,
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

    days = []
    template_use: dict[str, int] = {}  # vary exercise choice when a day type repeats
    for weekday, title in zip(WEEKDAYS[days_per_week], SPLITS[days_per_week]):
        variant = template_use.get(title, 0)
        template_use[title] = variant + 1
        day = RoutineDay(weekday=weekday, title=title, cardio_minutes=cardio)
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
        split=SPLIT_NAMES[days_per_week],
        days_per_week=days_per_week,
        minutes_per_session=minutes_per_session,
        exercises_per_day=n_exercises,
        reps=reps,
        days=days,
        notes=notes,
    )
