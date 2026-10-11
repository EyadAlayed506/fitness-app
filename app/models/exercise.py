from enum import StrEnum

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


class ExercisePublic(SQLModel):
    id: int
    name: str
    aliases: str
    category: str
    muscle_group: MuscleGroup
    primary_muscles: str
    equipment: str
    qr_code: str
