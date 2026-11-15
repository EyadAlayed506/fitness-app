"""The real app's web build is served by the backend; the API is untouched."""

import pytest

from app import web_app
from app.config import get_settings
from tests.conftest import signup_and_login

INDEX = '<!DOCTYPE html><html><head><title>Fitness App</title></head><body><div id="root">web build</div></body></html>'


@pytest.fixture
def web_build(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "_expo" / "static" / "js" / "web").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / "_expo" / "static" / "js" / "web" / "entry-abc123.js").write_text("console.log('app')")
    (tmp_path / "secret.txt").write_text("outside the build")
    monkeypatch.setattr(get_settings(), "web_app_dir", str(dist))
    return dist


@pytest.fixture
def no_web_build(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "web_app_dir", str(tmp_path / "not-built"))


def test_home_is_the_web_app(client, web_build):
    r = client.get("/")
    assert r.status_code == 200 and "web build" in r.text
    assert r.headers["cache-control"] == "no-cache"  # updates reach testers on the next visit


def test_app_scripts_are_served(client, web_build):
    r = client.get("/_expo/static/js/web/entry-abc123.js")
    assert r.status_code == 200 and r.text == "console.log('app')"


@pytest.mark.parametrize("page", ["/sleep", "/workouts", "/onboarding", "/some/deep/link"])
def test_page_addresses_open_the_app(client, web_build, page):
    r = client.get(page)
    assert r.status_code == 200 and "web build" in r.text


def test_missing_files_are_real_404s(client, web_build):
    assert client.get("/_expo/static/js/web/gone.js").status_code == 404
    assert client.get("/static/missing.css").status_code == 404


def test_api_answers_are_unchanged(client, web_build):
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    auth = signup_and_login(client)
    r = client.get("/api/workouts/999999", headers=auth)
    assert r.status_code == 404 and r.json() == {"detail": "Workout not found"}
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.post("/not-a-page").status_code == 404  # only page views get the app


def test_cannot_read_files_outside_the_build(web_build):
    assert web_app.resolve("../secret.txt") is None
    assert web_app.resolve("_expo/../../secret.txt") is None
    assert web_app.resolve("/index.html") == web_build.resolve() / "index.html"


def test_without_a_build_the_simple_preview_stays(client, no_web_build):
    r = client.get("/")
    assert r.status_code == 200 and "/static/app.js" in r.text
    assert client.get("/sleep").status_code == 404
    assert "/static/app.js" in client.get("/preview").text
