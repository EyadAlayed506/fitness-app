import datetime as dt
import json

from pydantic import field_validator
from sqlmodel import Field, SQLModel

from app.models.exercise import ExercisePublic
from app.models.user import utcnow


def _utc(value: dt.datetime | None) -> dt.datetime | None:
    # SQLite drops the timezone; times are stored in UTC
    return value.replace(tzinfo=dt.UTC) if value and value.tzinfo is None else value


# ---------- gyms ----------

class Gym(SQLModel, table=True):
    """A place the user trains. Workouts, saved machine photos and machine settings belong to one."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str
    is_default: bool = False
    # What's there, from "photograph a gym" (JSON: {"machines": [exercise ids], "equipment": ["dumbbells", ...]})
    equipment: str | None = None
    created_at: dt.datetime = Field(default_factory=utcnow)

    def equipment_dict(self) -> dict:
        try:
            data = json.loads(self.equipment or "{}")
        except ValueError:
            data = {}
        return {"machines": [int(i) for i in data.get("machines", [])], "equipment": list(data.get("equipment", []))}


class GymIn(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    make_default: bool = False


class GymUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    is_default: bool | None = None  # only True does something: this becomes the default gym


class GymPublic(SQLModel):
    id: int
    name: str
    is_default: bool
    machines: list[int]  # machines seen in "photograph a gym" (exercise ids)
    equipment: list[str]  # free weights etc. seen there: dumbbells, barbell, cable
    photos: int  # saved machine photos
    settings: int  # machines with saved settings
    workouts: int


class WorkoutGymIn(SQLModel):
    gym_id: int


# ---------- machine settings ----------

class MachineSetting(SQLModel, table=True):
    """How a user sets up one machine at one gym: seat, pins, back pad, handle."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    gym_id: int = Field(foreign_key="gym.id", index=True)
    exercise_id: int = Field(foreign_key="exercise.id", index=True)
    seat: str = ""
    pins: str = ""
    back_pad: str = ""
    handle: str = ""
    notes: str = ""
    updated_at: dt.datetime = Field(default_factory=utcnow)


class MachineSettingIn(SQLModel):
    seat: str = Field(default="", max_length=40)
    pins: str = Field(default="", max_length=40)
    back_pad: str = Field(default="", max_length=40)
    handle: str = Field(default="", max_length=60)
    notes: str = Field(default="", max_length=300)


class MachineSettingPublic(MachineSettingIn):
    gym_id: int
    exercise_id: int
    exercise_name: str
    saved: bool  # False: nothing saved yet for this machine at this gym
    updated_at: dt.datetime | None = None

    @field_validator("updated_at")
    @classmethod
    def assume_utc(cls, value: dt.datetime | None) -> dt.datetime | None:
        return _utc(value)


# ---------- saved machine photos ("the app learns your machines") ----------

class MachinePhoto(SQLModel, table=True):
    """A photo the user confirmed (or corrected) as a machine, kept to recognise that machine next time."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    gym_id: int | None = Field(default=None, foreign_key="gym.id", index=True)
    exercise_id: int = Field(foreign_key="exercise.id", index=True)
    file_name: str  # under photos_dir; never served without the owner's login
    thumbnail: str = ""  # small JPEG as a data URI, for the list in the app
    embedding: str | None = None  # JSON list of floats; None until the photo model is available
    embedding_model: str | None = None
    corrected: bool = False  # the user picked a different machine than the app's first guess
    created_at: dt.datetime = Field(default_factory=utcnow)


class PhotoIn(SQLModel):
    photo_token: str = Field(min_length=8, max_length=64)  # from the recognise answer
    exercise_id: int
    gym_id: int | None = None  # default: the user's default gym
    corrected: bool = False


class MachinePhotoPublic(SQLModel):
    id: int
    exercise_id: int
    exercise_name: str
    gym_id: int | None
    thumbnail: str
    corrected: bool
    matchable: bool  # has an embedding (False until the photo model has been downloaded)
    created_at: dt.datetime

    @field_validator("created_at")
    @classmethod
    def assume_utc(cls, value: dt.datetime) -> dt.datetime:
        return _utc(value)


class MemoryMatch(SQLModel):
    exercise: ExercisePublic
    similarity: float  # 0 to 1 (cosine similarity of the two photos)
    photo_id: int
    taken_at: dt.datetime

    @field_validator("taken_at")
    @classmethod
    def assume_utc(cls, value: dt.datetime) -> dt.datetime:
        return _utc(value)


class PhotoMatchStatus(SQLModel):
    ready: bool  # the model is downloaded and photos can be matched
    downloading: bool
    downloaded_mb: float
    size_mb: float  # the model's download size
    model: str
    problem: str | None  # why it isn't ready, and how to fix it
    threshold: float


class SmartRecognitionOut(SQLModel):
    """What a photo shows: from the user's own earlier photos when one matches, otherwise the vision model."""

    source: str  # "memory" (matched an earlier photo), "model" (the vision model's best guess) or "none"
    photo_token: str  # send it back with the confirmed machine to remember this photo
    match: MemoryMatch | None
    guesses: list  # RecognizedExercise items, best first
    seen: str
    model: str
    problem: str | None  # why the vision model couldn't help (then the user picks by hand)
    memory_ready: bool
    memory_seconds: float  # time spent comparing with earlier photos
