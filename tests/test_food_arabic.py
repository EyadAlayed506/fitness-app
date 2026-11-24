"""Searching and showing the built-in foods in Arabic ("موز" finds Banana), and honest online-search warnings."""

import json
import logging

import httpx
import pytest
from sqlmodel import select

from app.main import app
from app.models.food import Food, FoodSource
from app.routers.foods import get_http_client
from app.seed import seed_catalogue
from app.services.food_search import search_local
from tests.conftest import OFF_RESPONSE, USDA_RESPONSE

AR = {"Accept-Language": "ar"}


def search(client, auth, q, lang=None, online=False):
    headers = {**auth, **({"Accept-Language": lang} if lang else {})}
    r = client.get("/api/foods/search", params={"q": q, "online": online}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("q, english", [
    ("موز", "Banana"),
    ("موزة", "Banana"),
    ("موزه", "Banana"),          # taa marbuta written as haa
    ("تمر", "Dates, Medjool"),
    ("طماطة", "Tomato"),
    ("حمص حب", "Chickpeas, cooked"),
    ("صدر دجاج", "Chicken breast, roasted, skinless"),
    ("رز", "White rice, cooked"),
    ("أرز", "White rice, cooked"),
    ("ارز", "White rice, cooked"),  # alef without hamza
])
def test_arabic_words_find_the_builtin_food(client, auth, session, q, english):
    first = search(client, auth, q, lang="ar")["local"][0]
    assert session.get(Food, first["id"]).name == english


def test_name_is_shown_in_the_apps_language(client, auth):
    assert search(client, auth, "موز", lang="ar")["local"][0]["name"] == "موز"
    assert search(client, auth, "موز", lang="en")["local"][0]["name"] == "Banana"
    assert search(client, auth, "banana", lang="ar")["local"][0]["name"] == "موز"  # English words still work


def test_english_search_is_unchanged(client, auth):
    local = search(client, auth, "banana")["local"]
    assert local[0]["name"] == "Banana"
    rice = [f["name"] for f in search(client, auth, "rice")["local"]]
    assert {"White rice, cooked", "Brown rice, cooked"} <= set(rice[:3])


def test_food_log_shows_the_arabic_name(client, auth):
    banana = search(client, auth, "banana")["local"][0]
    entry = client.post("/api/food-logs", json={"food_id": banana["id"], "quantity": 1, "unit": "serving",
                                                "meal": "breakfast"}, headers={**auth, **AR}).json()
    assert entry["food_name"] == "موز"
    day_ar = client.get("/api/food-logs", headers={**auth, **AR}).json()
    day_en = client.get("/api/food-logs", headers=auth).json()
    assert day_ar["entries"][0]["food_name"] == "موز" and day_en["entries"][0]["food_name"] == "Banana"


def use_handler(handler):
    async def http_client():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            yield c
    app.dependency_overrides[get_http_client] = http_client


def test_arabic_search_asks_usda_for_the_english_name(client, auth):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "nal.usda.gov" in request.url.host:
            seen.append(("usda", json.loads(request.content)["query"]))
            return httpx.Response(200, json=USDA_RESPONSE)
        seen.append(("off", request.url.params["search_terms"]))
        return httpx.Response(200, json=OFF_RESPONSE)

    use_handler(handler)
    r = search(client, auth, "موز", lang="ar", online=True)
    assert ("usda", "Banana") in seen and ("off", "موز") in seen
    assert r["warnings"] == []


def test_arabic_search_with_no_builtin_match_skips_usda_instead_of_calling_it_unreachable(client, auth):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        return httpx.Response(200, json=OFF_RESPONSE)

    use_handler(handler)
    r = search(client, auth, "كبسة", lang="ar", online=True)  # not in the built-in list
    assert not any("usda" in h for h in seen)
    assert r["warnings"] == []  # no false "USDA is unreachable"


def test_a_failed_online_search_is_logged_with_its_reason_but_not_the_key(client, auth, caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        if "nal.usda.gov" in request.url.host:
            return httpx.Response(429)  # e.g. the shared DEMO_KEY's rate limit
        return httpx.Response(200, json=OFF_RESPONSE)

    use_handler(handler)
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        r = search(client, auth, "rice", online=True)
    assert len(r["warnings"]) == 1 and "USDA" in r["warnings"][0]
    logged = " ".join(rec.getMessage() for rec in caplog.records)
    assert "USDA FoodData Central failed (HTTPStatusError, HTTP 429)" in logged
    assert "api_key" not in logged and "DEMO_KEY" not in logged


def test_coach_lookup_stays_english_only():
    """COACH-02 relies on Arabic names missing the food list (the coach retries in English).
    Arabic matching is opt-in, so the coach's search_local call is unchanged."""
    banana = Food(id=1, name="Banana", source=FoodSource.builtin, name_ar="موز", aliases_ar="موزة",
                  calories=89, protein_g=1.1, carbs_g=22.8, fat_g=0.3)
    assert search_local([banana], "موزة") == []
    assert search_local([banana], "موزة", arabic=True) == [banana]


def test_existing_database_gains_arabic_names_without_other_changes(session):
    banana = session.exec(select(Food).where(Food.source == FoodSource.builtin, Food.name == "Banana")).one()
    calories, banana_id = banana.calories, banana.id
    banana.name_ar = banana.aliases_ar = None  # as in a database made before this change
    session.add(banana)
    session.commit()

    seed_catalogue(session)
    session.refresh(banana)
    assert banana.name_ar == "موز" and "موزة" in banana.aliases_ar
    assert banana.id == banana_id and banana.calories == calories
    assert len(session.exec(select(Food).where(Food.source == FoodSource.builtin)).all()) == 38


# ---- rate limits: the server protects the shared online databases ------------------------------------

def counting_handler(calls, usda_status=200, off_status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        if "nal.usda.gov" in request.url.host:
            calls.append("usda")
            return httpx.Response(usda_status, json=USDA_RESPONSE if usda_status == 200 else {})
        calls.append("off")
        return httpx.Response(off_status, json=OFF_RESPONSE if off_status == 200 else {})
    return handler


def test_one_or_two_letters_search_locally_only(client, auth):
    calls = []
    use_handler(counting_handler(calls))
    for q in ("l", "lk", "مو"):
        r = search(client, auth, q, online=True)
        assert r["online"] == [] and r["warnings"] == []
    assert calls == []


def test_the_same_words_reuse_the_earlier_online_answer(client, auth):
    calls = []
    use_handler(counting_handler(calls))
    first = search(client, auth, "quinoa", online=True)
    again = search(client, auth, "Quinoa ", online=True)  # case and spaces don't matter
    assert sorted(calls) == ["off", "usda"]  # asked once, not twice
    assert again["online"] == first["online"] and first["online"]


def test_rate_limited_source_shows_busy_and_rests_for_a_minute(client, auth):
    calls = []
    use_handler(counting_handler(calls, usda_status=429))
    r = search(client, auth, "quinoa", online=True)
    assert r["warnings"] == ["USDA FoodData Central is busy right now. Try again in a minute"]
    assert any(c["source"] == "off" for c in r["online"])  # the other source still answers

    calls.clear()
    r = search(client, auth, "lentils", lang="ar", online=True)  # different words, within the minute
    assert "usda" not in calls  # not asked again while resting
    # Arabic text wraps the source name in invisible direction marks (FSI/PDI) so it displays correctly
    plain = [w.replace("\u2068", "").replace("\u2069", "") for w in r["warnings"]]
    assert plain == ["USDA FoodData Central مشغول الآن. حاول مجدداً بعد دقيقة"]


def test_network_failures_are_not_remembered(client, auth):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        raise httpx.ConnectError("no network")

    use_handler(handler)
    search(client, auth, "quinoa", online=True)
    search(client, auth, "quinoa", online=True)
    assert len(calls) == 4  # both sources asked both times: a connection error is neither cached nor rested


def test_usda_is_asked_with_its_json_form(client, auth):
    """USDA's GET search failed about 40% of the time in a live test; the JSON POST form never did."""
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "nal.usda.gov" in request.url.host:
            sent.append(request)
            return httpx.Response(200, json=USDA_RESPONSE)
        return httpx.Response(200, json=OFF_RESPONSE)

    use_handler(handler)
    r = search(client, auth, "quinoa", online=True)
    assert any(c["source"] == "usda" for c in r["online"])
    (req,) = sent
    assert req.method == "POST"
    assert json.loads(req.content) == {"query": "quinoa", "pageSize": 8,
                                       "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)"]}
    assert set(req.url.params) == {"api_key"}  # nothing else in the address
