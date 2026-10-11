import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app import models  # noqa: F401  (register tables)
from app.database import get_session
from app.main import app
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
