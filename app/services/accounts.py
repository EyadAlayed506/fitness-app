from sqlmodel import Session, delete, select

from app.models.assistant import ChatMessage
from app.models.exercise import RestPreference
from app.models.food import Food, FoodLog
from app.models.gym import Gym, MachinePhoto, MachineSetting
from app.models.measurement import BodyMeasurement
from app.models.points import PointAward
from app.models.sleep import SleepEntry
from app.models.snap import CustomDay
from app.models.user import Profile, User, WeightEntry
from app.models.whoop import WhoopConnection
from app.models.workout import WorkoutSession, WorkoutSet
from app.services.photo_match import delete_photo_file


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
    session.exec(delete(PointAward).where(PointAward.user_id == user.id))
    session.exec(delete(ChatMessage).where(ChatMessage.user_id == user.id))
    for photo in session.exec(select(MachinePhoto).where(MachinePhoto.user_id == user.id)).all():
        delete_photo_file(photo.file_name)  # the photo files too, not just their rows
    session.exec(delete(MachinePhoto).where(MachinePhoto.user_id == user.id))
    session.exec(delete(MachineSetting).where(MachineSetting.user_id == user.id))
    session.exec(delete(Gym).where(Gym.user_id == user.id))
    session.exec(delete(CustomDay).where(CustomDay.user_id == user.id))
    session.delete(user)
    session.commit()
