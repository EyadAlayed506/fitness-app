"""Two testers' gyms, saved machine photos and imported sleep stay separate (BE-02 follow-up)."""

from sqlmodel import select

from app.models.gym import MachinePhoto
from app.models.sleep import SleepEntry
from app.models.user import User
from tests.conftest import signup_and_login
from tests.test_health_connect import night, send


def user_id(session, email):
    return session.exec(select(User).where(User.email == email)).one().id


def test_gyms_and_saved_photos_are_private(client, session):
    ali = signup_and_login(client, email="ali@example.com")
    noor = signup_and_login(client, email="noor@example.com")
    gym = client.post("/api/gyms", json={"name": "Ali's gym"}, headers=ali).json()
    workout = client.post("/api/workouts", json={}, headers=ali).json()
    noor_workout = client.post("/api/workouts", json={}, headers=noor).json()

    # a saved photo of Ali's (saving normally needs a real camera photo, so the record is made directly)
    photo = MachinePhoto(user_id=user_id(session, "ali@example.com"), gym_id=gym["id"], exercise_id=1, file_name="x/p.jpg")
    session.add(photo)
    session.commit()

    assert all(g["name"] != "Ali's gym" for g in client.get("/api/gyms", headers=noor).json())
    assert client.get("/api/photo-memory/photos", headers=noor).json() == []
    for call in (
        lambda: client.patch(f"/api/gyms/{gym['id']}", json={"name": "mine now"}, headers=noor),
        lambda: client.delete(f"/api/gyms/{gym['id']}", headers=noor),
        lambda: client.get(f"/api/gyms/{gym['id']}/inventory", headers=noor),
        lambda: client.get(f"/api/gyms/{gym['id']}/machines", headers=noor),
        lambda: client.put(f"/api/workouts/{workout['id']}/gym", json={"gym_id": gym["id"]}, headers=noor),
        # Noor's own workout can't be put at Ali's gym either
        lambda: client.put(f"/api/workouts/{noor_workout['id']}/gym", json={"gym_id": gym["id"]}, headers=noor),
        lambda: client.delete(f"/api/photo-memory/photos/{photo.id}", headers=noor),
    ):
        assert call().status_code == 404

    assert any(g["name"] == "Ali's gym" for g in client.get("/api/gyms", headers=ali).json())
    assert len(client.get("/api/photo-memory/photos", headers=ali).json()) == 1


def test_same_health_connect_record_id_never_crosses_accounts(client, session):
    """Two phones can report the same record id; each tester keeps their own night."""
    ali = signup_and_login(client, email="ali@example.com")
    noor = signup_and_login(client, email="noor@example.com")

    assert send(client, ali, night("hc-night-1"))["imported"] == 1
    # same id and overlapping times from Noor's phone: a new night for Noor, not an update of Ali's
    assert send(client, noor, night("hc-night-1", end="05:00:00"))["imported"] == 1

    session.expire_all()
    rows = session.exec(select(SleepEntry).order_by(SleepEntry.user_id)).all()
    assert len(rows) == 2
    by_user = {r.user_id: r for r in rows}
    ali_night = by_user[user_id(session, "ali@example.com")]
    noor_night = by_user[user_id(session, "noor@example.com")]
    ali_wake = ali_night.wake_time
    assert ali_wake != noor_night.wake_time  # Ali's night was not overwritten

    # each sees exactly one night
    assert len(client.get("/api/sleep", headers=ali).json()) == 1
    assert len(client.get("/api/sleep", headers=noor).json()) == 1

    # re-sending updates only the sender's own night
    assert send(client, noor, night("hc-night-1", end="05:30:00"))["updated"] == 1
    session.expire_all()
    assert session.get(SleepEntry, ali_night.id).wake_time == ali_wake
