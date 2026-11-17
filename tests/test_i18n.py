"""The request language (Accept-Language) and the server's English/Arabic texts."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.i18n import (
    FSI,
    PDI,
    LanguageMiddleware,
    current_language,
    parse_accept_language,
    reset_language,
    set_language,
    tr,
    tr_count,
)

TABLE = {
    "en": {"hello": "Hello {name}", "days": "{n} day|{n} days", "only_en": "Only English"},
    "ar": {"hello": "مرحباً {name}", "days": "{n} أيام|يوم واحد|يومان|{n} أيام|{n} يوماً|{n} يوم"},
}


def in_arabic(fn):
    token = set_language("ar")
    try:
        return fn()
    finally:
        reset_language(token)


def test_accept_language():
    assert parse_accept_language("ar") == "ar"
    assert parse_accept_language("ar-SA,en;q=0.8") == "ar"
    assert parse_accept_language("en-US,ar;q=0.9") == "en", "only the first language counts"
    assert parse_accept_language("fr") == "en"
    assert parse_accept_language(None) == "en"
    assert parse_accept_language("") == "en"


def test_english_by_default():
    assert current_language() == "en"
    assert tr(TABLE, "hello", name="Sam") == "Hello Sam"


def test_arabic_text_with_isolated_values():
    assert in_arabic(lambda: tr(TABLE, "hello", name="Sam")) == f"مرحباً {FSI}Sam{PDI}"


def test_missing_arabic_falls_back_to_english():
    assert in_arabic(lambda: tr(TABLE, "only_en")) == "Only English"


def test_counts_use_each_languages_plural_forms():
    assert tr_count(TABLE, "days", 1) == "1 day"
    assert tr_count(TABLE, "days", 3) == "3 days"
    plain = lambda s: s.replace(FSI, "").replace(PDI, "")  # noqa: E731
    assert in_arabic(lambda: plain(tr_count(TABLE, "days", 1))) == "يوم واحد"
    assert in_arabic(lambda: plain(tr_count(TABLE, "days", 2))) == "يومان"
    assert in_arabic(lambda: plain(tr_count(TABLE, "days", 5))) == "5 أيام"
    assert in_arabic(lambda: plain(tr_count(TABLE, "days", 11))) == "11 يوماً"
    assert in_arabic(lambda: plain(tr_count(TABLE, "days", 100))) == "100 يوم"


def test_the_request_language_reaches_endpoints_run_in_threads():
    app = FastAPI()
    app.add_middleware(LanguageMiddleware)

    @app.get("/sync")
    def sync_endpoint():  # FastAPI runs plain functions in a worker thread
        return {"lang": current_language()}

    @app.get("/async")
    async def async_endpoint():
        return {"lang": current_language()}

    client = TestClient(app)
    for path in ("/sync", "/async"):
        assert client.get(path, headers={"Accept-Language": "ar"}).json() == {"lang": "ar"}
        assert client.get(path, headers={"Accept-Language": "en"}).json() == {"lang": "en"}
        assert client.get(path).json() == {"lang": "en"}
    assert current_language() == "en", "a request's language doesn't leak out of it"
