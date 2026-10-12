import datetime as dt

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app import models  # noqa: F401  (register tables)
from app.config import get_settings
from app.database import get_session
from app.main import app
from app.models.sleep import SleepEntry
from app.models.workout import WorkoutSession, WorkoutSet
from app.routers.foods import get_http_client
from app.seed import seed_catalogue

USDA_RESPONSE = {
    "foods": [
        {
            "fdcId": 171705,
            "description": "QUINOA, COOKED",
            "foodNutrients": [
                {"nutrientNumber": "208", "unitName": "KCAL", "value": 120},
                {"nutrientNumber": "203", "unitName": "G", "value": 4.4},
                {"nutrientNumber": "205", "unitName": "G", "value": 21.3},
                {"nutrientNumber": "204", "unitName": "G", "value": 1.9},
                {"nutrientNumber": "291", "unitName": "G", "value": 2.8},
                {"nutrientNumber": "307", "unitName": "MG", "value": 7},
            ],
        }
    ]
}

OFF_RESPONSE = {
    "products": [
        {
            "code": "5449000000996",
            "product_name": "Quinoa drink",
            "brands": "Brand A, Brand B",
            "quantity": "1 l",
            "serving_quantity": "250",
            "nutriments": {
                "energy-kcal_100g": 48,
                "proteins_100g": 1.1,
                "carbohydrates_100g": 9.5,
                "fat_100g": 0.8,
                "sodium_100g": 0.04,
            },
        }
    ]
}


def mock_handler(request: httpx.Request) -> httpx.Response:
    if "nal.usda.gov" in request.url.host:
        return httpx.Response(200, json=USDA_RESPONSE)
    if "openfoodfacts" in request.url.host:
        return httpx.Response(200, json=OFF_RESPONSE)
    return httpx.Response(404)


@pytest.fixture(autouse=True)
def whoop_off(monkeypatch):
    """Tests never use the WHOOP keys from a developer's own .env (test_whoop turns on a fake WHOOP)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "whoop_client_id", "")
    monkeypatch.setattr(settings, "whoop_client_secret", "")
    monkeypatch.setattr(settings, "whoop_redirect_uri", "http://localhost:8000/api/whoop/callback")
    monkeypatch.setattr(settings, "whoop_base_url", "https://api.prod.whoop.com")


@pytest.fixture
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalogue(session)
        yield session


@pytest.fixture
def client(session):
    async def mock_http_client():
        async with httpx.AsyncClient(transport=httpx.MockTransport(mock_handler)) as c:
            yield c

    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_http_client] = mock_http_client
    yield TestClient(app)
    app.dependency_overrides.clear()


def signup_and_login(client, email="sara@example.com", password="secret123", marketing=False) -> dict:
    r = client.post("/api/auth/signup", json={"email": email, "password": password, "marketing_opt_in": marketing})
    assert r.status_code == 201, r.text
    r = client.post("/api/auth/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


PROFILE = {
    "birth_date": "1996-05-20",
    "sex": "male",
    "height": 180,
    "height_unit": "cm",
    "weight": 95,
    "weight_unit": "kg",
    "activity_level": "moderate",
    "goal": "auto",
    "diet_option": "normal",
    "days_per_week": 4,
    "minutes_per_session": 60,
    "equipment": "gym",
}


@pytest.fixture
def auth(client):
    headers = signup_and_login(client)
    r = client.put("/api/me/profile", json=PROFILE, headers=headers)
    assert r.status_code == 200, r.text
    return headers


UTC_NOON = dt.time(12, tzinfo=dt.UTC)


def add_workout(session, user, day: dt.date, sets: list[tuple[int, int, float]] | None = None) -> WorkoutSession:
    """A finished workout at noon UTC on `day`. sets: (exercise_id, reps, weight_kg); default one set."""
    start = dt.datetime.combine(day, UTC_NOON)
    w = WorkoutSession(user_id=user.id, started_at=start, ended_at=start + dt.timedelta(hours=1))
    session.add(w)
    session.commit()
    for i, (exercise_id, reps, weight) in enumerate(sets or [(1, 10, 40)]):
        session.add(WorkoutSet(session_id=w.id, exercise_id=exercise_id, set_number=i + 1, reps=reps, weight_kg=weight))
    session.commit()
    return w


def add_sleep(session, user, day: dt.date, minutes: int, source="manual", logged_on: dt.date | None = None):
    """A night ending at 07:00 on `day`, logged that morning unless `logged_on` says otherwise."""
    wake = dt.datetime.combine(day, dt.time(7))
    e = SleepEntry(user_id=user.id, date=day, bedtime=wake - dt.timedelta(minutes=minutes), wake_time=wake,
                   duration_minutes=minutes, source=source)
    if logged_on:
        e.created_at = dt.datetime.combine(logged_on, UTC_NOON)
    session.add(e)
    session.commit()
    return e
