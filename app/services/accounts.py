from sqlmodel import Session, delete, select

from app.models.exercise import RestPreference
from app.models.food import Food, FoodLog
from app.models.measurement import BodyMeasurement
from app.models.sleep import SleepEntry
from app.models.user import Profile, User, WeightEntry
from app.models.whoop import WhoopConnection
from app.models.workout import WorkoutSession, WorkoutSet


def delete_user(session: Session, user: User) -> None:
    """Delete a user and every piece of data that belongs to them."""
    session_ids = select(WorkoutSession.id).where(WorkoutSession.user_id == user.id)
    session.exec(delete(WorkoutSet).where(WorkoutSet.session_id.in_(session_ids)))
    for model in (WorkoutSession, FoodLog, WeightEntry, BodyMeasurement, SleepEntry):
        session.exec(delete(model).where(model.user_id == user.id))
    session.exec(delete(Food).where(Food.owner_id == user.id))
    session.exec(delete(Profile).where(Profile.user_id == user.id))
    session.exec(delete(RestPreference).where(RestPreference.user_id == user.id))
    session.exec(delete(WhoopConnection).where(WhoopConnection.user_id == user.id))
    session.delete(user)
    session.commit()
