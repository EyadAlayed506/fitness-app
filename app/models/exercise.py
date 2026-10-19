from enum import StrEnum

from pydantic import field_validator
from sqlmodel import Field, SQLModel


class MuscleGroup(StrEnum):
    chest = "chest"
    back = "back"
    shoulders = "shoulders"
    quads = "quads"
    hamstrings = "hamstrings"
    glutes = "glutes"
    calves = "calves"
    biceps = "biceps"
    triceps = "triceps"
    core = "core"


# Coarser groups used by the training-volume chart
BODY_REGION = {
    MuscleGroup.chest: "Chest",
    MuscleGroup.back: "Back",
    MuscleGroup.shoulders: "Shoulders",
    MuscleGroup.quads: "Legs",
    MuscleGroup.hamstrings: "Legs",
    MuscleGroup.glutes: "Legs",
    MuscleGroup.calves: "Legs",
    MuscleGroup.biceps: "Arms",
    MuscleGroup.triceps: "Arms",
    MuscleGroup.core: "Core",
}


class Exercise(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    aliases: str = ""  # comma separated
    category: str  # machine / free weight / cable / bodyweight
    muscle_group: MuscleGroup
    primary_muscles: str = ""
    # minimum setup needed: "gym" (machines/barbells), "home" (dumbbells), "bodyweight"
    equipment: str
    qr_code: str = Field(unique=True, index=True)
    # From the curated seed file (app/seed/exercises.json)
    pattern: str | None = None  # movement pattern, e.g. "squat", "vertical_pull"
    instructions: str | None = None  # one step per line
    default_rest_seconds: int | None = None


DEFAULT_REST_SECONDS = 90  # for an exercise without its own default


class ExercisePublic(SQLModel):
    id: int
    name: str
    aliases: str
    category: str
    muscle_group: MuscleGroup
    primary_muscles: str
    equipment: str
    qr_code: str
    pattern: str | None = None
    instructions: list[str] = []
    default_rest_seconds: int = DEFAULT_REST_SECONDS

    @field_validator("instructions", mode="before")
    @classmethod
    def split_lines(cls, value):
        if isinstance(value, str):
            return [line for line in value.split("\n") if line.strip()]
        return value or []

    @field_validator("default_rest_seconds", mode="before")
    @classmethod
    def rest_default(cls, value):
        return value or DEFAULT_REST_SECONDS


class RestPreference(SQLModel, table=True):
    """A user's own rest time for one exercise (set from the rest timer). Overrides the exercise default."""

    user_id: int = Field(foreign_key="user.id", primary_key=True)
    exercise_id: int = Field(foreign_key="exercise.id", primary_key=True)
    seconds: int


MIN_REST_SECONDS = 15
MAX_REST_SECONDS = 600


class RestSetting(SQLModel):
    exercise_id: int
    default_seconds: int  # the user's rest time for all exercises (Profile.rest_seconds), else this exercise's suggestion
    preferred_seconds: int | None  # set for this exercise only
    seconds: int  # what the timer uses: the user's preference, else the default


class RestSettingIn(SQLModel):
    seconds: int | None = Field(default=None, ge=MIN_REST_SECONDS, le=MAX_REST_SECONDS)  # None = back to the default


class AlternativePublic(SQLModel):
    exercise: ExercisePublic
    match: str  # "similar" or "different"
    reasons: list[str]
    differences: list[str]


class RecognizedExercise(SQLModel):
    exercise: ExercisePublic
    confidence: float  # 0 to 1, the vision model's own estimate


class RecognitionOut(SQLModel):
    guesses: list[RecognizedExercise]  # best first; empty when nothing in the catalogue matched
    seen: str  # what the model says the photo shows
    model: str


class AlternativesOut(SQLModel):
    exercise: ExercisePublic
    equipment: str | None
    filtered_by_equipment: bool
    alternatives: list[AlternativePublic]
