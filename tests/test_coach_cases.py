"""COACH-01: the coach's evaluation cases (tests/coach_cases.json), checked without an AI model.

- The case file itself is checked: every case in English and Arabic, real tool names, every category covered.
- Each case's `script` runs its tool calls in the case's language, against the case's data, and checks what was
  saved (or not). This pins down the logging rules a model must work within, in both languages.
- Cases marked `known_gap` describe the behaviour we want; they are expected to fail until COACH-02 fixes them
  (strict, so a fix makes the test say so).

The `expect` part of each case (tools, actions, reply rubric) is for runs with a real model (COACH-04).
"""

import datetime as dt
import json
import re
from pathlib import Path

import anthropic
import httpx
import pytest
from sqlmodel import select

from app.coach_eval import ARABIC, CASES_FILE, LANGS, arabic_share, build_fixture, load_cases
from app.i18n import reset_language, set_language
from app.main import app
from app.models.user import Profile, User
from app.routers.assistant import get_assistant_backend
from app.services import assistant
from tests.test_assistant import FakeClaude, reply, tool_use

CASES = load_cases()
CATEGORIES = {
    "personal_data", "missing_data", "logging_action", "incomplete_request", "ambiguous_units",
    "isolation", "provider_failure", "safety", "evidence_disabled", "language",
}


# ---------- the case file ----------


def test_case_file_is_complete():
    cases = CASES["cases"]
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids)), "case ids are unique"
    assert {c["category"] for c in cases} == CATEGORIES, "every category has at least one case"
    for c in cases:
        assert c["fixture"] in CASES["fixtures"], c["id"]
        assert set(c["message"]) == set(LANGS), f"{c['id']}: one message per language"
        assert ARABIC.search(c["message"]["ar"]), f"{c['id']}: the Arabic message is in Arabic"
        assert c["expect"]["reply"], f"{c['id']}: a reply rubric"
        assert isinstance(c["expect"]["actions"], int)
        for name in c["expect"].get("tools_any", []) + [s["tool"] for s in c.get("script", [])]:
            assert name in assistant.TOOLS_BY_NAME, f"{c['id']}: no tool called {name}"
        for ref in c.get("covered_by", []):
            path, test = ref.split("::")
            assert f"def {test}(" in (Path(__file__).parent.parent / path).read_text(encoding="utf-8"), ref


# ---------- running the scripted tool calls ----------


def _user(session, email="sara@example.com") -> User:
    return session.exec(select(User).where(User.email == email)).one()


def _ctx(session, user: User, question: str | None) -> assistant.ToolContext:
    return assistant.ToolContext(session=session, user=user, profile=session.get(Profile, user.id), tz_offset=0,
                                 question=question)


def _fill(value, values: dict):
    if isinstance(value, str):
        m = re.fullmatch(r"\{(\w+)\}", value)
        if m:
            return values[m.group(1)]
        return value.format(**values) if "{" in value else value
    return value


SCRIPTED = [
    pytest.param(c, lang, id=f"{c['id']}-{lang}",
                 marks=[pytest.mark.xfail(strict=True, reason=c["known_gap"])] if c.get("known_gap") else [])
    for c in CASES["cases"] if c.get("script") for lang in LANGS
]


@pytest.mark.parametrize(("case", "lang"), SCRIPTED)
def test_scripted_case(case, lang, client, auth, session, monkeypatch):
    # no internet in tests: the online food search finds nothing (the AI-estimate path then applies)
    monkeypatch.setattr(assistant, "_search_online", lambda query: [])
    values = build_fixture(case["fixture"], client, session, "sara@example.com")  # the `auth` user
    token = set_language(case.get("app_language_override", {}).get(lang, lang))
    try:
        ctx = _ctx(session, _user(session), case["message"][lang])
        for step in case["script"]:
            args = {k: _fill(v, values) for k, v in step["args"].items()}
            before = len(ctx.actions)
            content, err = assistant.run_tool(ctx, step["tool"], args)
            where = f"{case['id']}/{lang}/{step['tool']}: {content[:200]}"
            assert err is step["error"], where
            if "contains" in step:
                assert step["contains"] in content, where
            if "actions" in step:
                assert len(ctx.actions) - before == step["actions"], where
            if "logged_meal" in step:
                assert json.loads(content)["logged"]["meal"] == step["logged_meal"], where
            if "logged_food" in step:
                assert json.loads(content)["food"] == step["logged_food"], where
            if "nights_logged" in step:
                nights = json.loads(content)["nights"]
                assert sum(n is not None for n in nights) == step["nights_logged"], where
            if lang == "ar" and len(ctx.actions) > before and not err:
                assert ARABIC.search(ctx.actions[-1].summary), f"{where}: the action card is in Arabic"
    finally:
        reset_language(token)


# ---------- known gaps outside the tools ----------


def test_partial_failure_reply_follows_the_app_language(client, auth):
    fake = FakeClaude(
        reply(tool_use("log_food", {"food": "banana", "meal": "breakfast"}), stop="tool_use"),
        anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com")),
    )
    app.dependency_overrides[get_assistant_backend] = lambda: assistant.ClaudeBackend(fake, "claude-opus-5-5")
    r = client.post("/api/assistant/messages?tz_offset=0", json={"text": "أضف موزة للفطور"},
                    headers={**auth, "Accept-Language": "ar"})
    assert r.status_code == 200
    answer = r.json()["answer"]
    assert answer["actions"], "the saved food is kept, with its Undo"
    assert answer["text"].startswith("أضفتُ: Banana") and "I added" not in answer["text"]
    assert "⁨" not in answer["text"], "no invisible direction marks"


@pytest.mark.parametrize("lang", LANGS)
def test_ollama_errors_follow_the_app_language(client, auth, lang):
    """Problems reaching the local model during a chat come back in the app's language, like Claude's."""
    replies: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen3:8b"}]})
        item = replies.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    http = httpx.Client(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_assistant_backend] = lambda: assistant.OllamaBackend(
        http, "http://localhost:11434", "qwen3:8b", 16384)
    headers = {**auth, "Accept-Language": lang}
    for item, status in [
        (httpx.ReadTimeout("slow"), 504),
        (httpx.ConnectError("down"), 502),
        (httpx.Response(404, json={"error": "model not found"}), 502),
        (httpx.Response(500, json={"error": "out of memory"}), 502),
    ]:
        replies.append(item)
        r = client.post("/api/assistant/messages?tz_offset=0", json={"text": "hi"}, headers=headers)
        detail = r.json()["detail"]
        assert r.status_code == status, detail
        assert bool(ARABIC.search(detail)) is (lang == "ar"), detail
        assert "⁨" not in detail
    assert "out of memory" in detail


# ---------- the runner for real models (app/coach_eval.py), with a fake Ollama ----------


def test_runner_asks_a_case_on_its_own_data_and_checks_the_reply(client, auth, session):
    from app import coach_eval
    from tests.test_assistant import FakeOllama, ollama_reply

    case = next(c for c in CASES["cases"] if c["id"] == "data-sleep-last-night")
    fake = FakeOllama(
        ollama_reply(tool_calls=[("get_sleep", {"days": 2})]),
        ollama_reply("نمت **6 س 30 د** البارحة، أقل من هدفك."),
    )
    http = httpx.Client(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_assistant_backend] = lambda: assistant.OllamaBackend(
        http, "http://localhost:11434", "qwen3:8b", 16384)
    result = coach_eval.ask_case(app, case, "ar")
    assert result["status"] == 200 and result["tools_used"] == ["get_sleep"]
    assert result["checks"] == {"tools": True, "actions": True, "language": True}
    nights = json.loads(fake.requests[1]["messages"][-1]["content"])["nights"]
    assert nights[-1]["main_minutes"] == 390, "the case's own data (week fixture), not the test user's"
    assert len(session.exec(select(User)).all()) == 1, "the run used its own throwaway database"

    md = coach_eval.markdown({"model": "qwen3:8b"}, [result])
    assert "| data-sleep-last-night | ar |" in md and "نمت" in md
    assert arabic_share("Banana، حصة واحدة") > 0.5 > arabic_share("1 serving of Banana")


def test_runner_lists_the_cases(capsys):
    from app import coach_eval

    assert coach_eval.main(["--list"]) == 0
    out = capsys.readouterr().out
    assert "action-sets" in out and "failure-provider-down" not in out  # failures are covered offline


def test_runner_end_to_end_writes_json_and_markdown(client, tmp_path, monkeypatch):
    from app import coach_eval
    from app.routers import assistant as assistant_router
    from tests.test_assistant import FakeOllama, ollama_reply

    fake = FakeOllama(*[ollama_reply("Which meal is it for?")] * 2)
    http = httpx.Client(transport=httpx.MockTransport(fake.handler))

    def backend():
        yield assistant.OllamaBackend(http, "http://localhost:11434", "qwen3:8b", 16384)

    app.dependency_overrides[get_assistant_backend] = backend
    monkeypatch.setattr(assistant_router, "get_assistant_backend", backend)
    monkeypatch.setattr(coach_eval, "OUT_DIR", tmp_path)
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "allow_signup", get_settings().allow_signup)  # main() turns it on; restore
    assert coach_eval.main(["--only", "incomplete-food-no-meal"]) == 0
    data = json.loads(next(tmp_path.glob("*.json")).read_text(encoding="utf-8"))
    assert [(r["id"], r["lang"]) for r in data["results"]] == [("incomplete-food-no-meal", "en"),
                                                                ("incomplete-food-no-meal", "ar")]
    assert data["run"]["prompt_sha256_12"] and data["results"][0]["checks"]["actions"] is True
    assert data["results"][1]["checks"]["language"] is False  # an English reply to an Arabic question
    assert "Score (pass / partly / fail)" in next(tmp_path.glob("*.md")).read_text(encoding="utf-8")
