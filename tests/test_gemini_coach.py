"""The coach on Google Gemini (its OpenAI-compatible API), against a fake Gemini: no real key or quota is used."""

import json

import httpx
import pytest
from sqlmodel import select

from app.config import get_settings
from app.main import app
from app.models.assistant import ChatMessage
from app.models.user import User
from app.routers.assistant import chosen_provider, get_assistant_backend
from app.services import assistant
from tests.conftest import add_sleep
from tests.test_assistant import TODAY, ask

URL = "https://gemini.test/v1beta/openai"
SIGNATURE = {"google": {"thought_signature": "c2lnbmF0dXJl"}}


class FakeGemini:
    """Answers /chat/completions like Gemini, from a script, and records each request (with its model)."""

    def __init__(self):
        self.replies: list = []
        self.requests: list[dict] = []
        self.headers: list[httpx.Headers] = []
        self.down = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        assert request.url.path == "/v1beta/openai/chat/completions"
        self.requests.append(json.loads(request.content))
        self.headers.append(request.headers)
        item = self.replies.pop(0)
        return item if isinstance(item, httpx.Response) else httpx.Response(200, json=item)


def gemini_reply(content=None, tool_calls=None, finish="stop", model="gemini-3.5-flash-lite"):
    message: dict = {"role": "assistant"}
    if content is not None:
        message["content"] = content
    if tool_calls:
        message["tool_calls"] = [
            {"id": f"call_{i}", "type": "function", "function": {"name": n, "arguments": a}, "extra_content": SIGNATURE}
            for i, (n, a) in enumerate(tool_calls)
        ]
        finish = "tool_calls"
    return {"object": "chat.completion", "model": model, "choices": [{"index": 0, "finish_reason": finish, "message": message}]}


def quota_error():
    return httpx.Response(429, json=[{"error": {"code": 429, "message": "Resource has been exhausted", "status": "RESOURCE_EXHAUSTED"}}])


def busy_error():
    return httpx.Response(503, json=[{"error": {"code": 503, "message": "This model is currently experiencing high demand.", "status": "UNAVAILABLE"}}])


@pytest.fixture
def gemini(client, monkeypatch):
    fake = FakeGemini()
    monkeypatch.setattr(assistant.GeminiBackend, "retry_pause", 0)
    http = httpx.Client(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_assistant_backend] = lambda: assistant.GeminiBackend(
        http, URL, "test-key", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"
    )
    return fake


def test_gemini_answers_from_the_users_data(client, auth, session, gemini):
    user = session.exec(select(User)).one()
    add_sleep(session, user, TODAY, 7 * 60 + 40)
    gemini.replies = [
        gemini_reply(tool_calls=[("get_sleep", '{"days": 7}')]),
        gemini_reply("You slept **7 h 40 min** last night, above your 7 h goal."),
    ]
    status = client.get("/api/assistant", headers=auth).json()
    assert status["configured"] and status["provider"] == "gemini" and status["model"] == "gemini-3.5-flash-lite"
    assert status["messages_left_today"] == get_settings().gemini_daily_limit
    assert "Google Gemini" in status["disclaimer"]  # testers are told where their questions go

    body = ask(client, auth).json()
    assert body["answer"]["text"] == "You slept **7 h 40 min** last night, above your 7 h goal."
    assert body["answer"]["tools_used"] == ["get_sleep"]
    assert body["messages_left_today"] == get_settings().gemini_daily_limit - 1

    first, second = gemini.requests
    assert gemini.headers[0]["authorization"] == "Bearer test-key"
    assert first["model"] == "gemini-3.5-flash-lite"
    assert first["messages"][0] == {"role": "system", "content": assistant.SYSTEM_PROMPT}
    assert TODAY.isoformat() in first["messages"][-1]["content"]
    assert {t["function"]["name"] for t in first["tools"]} == set(assistant.TOOLS_BY_NAME)
    # the tool call goes back exactly as Gemini sent it (its thought signature included), then the result
    call, result = second["messages"][-2], second["messages"][-1]
    assert call["role"] == "assistant" and call["tool_calls"][0]["extra_content"] == SIGNATURE
    assert result["role"] == "tool" and result["tool_call_id"] == "call_0"
    assert json.loads(result["content"])["nights"][-1]["main_minutes"] == 460


def test_gemini_logs_food_with_an_action_card(client, auth, gemini):
    gemini.replies = [
        gemini_reply(tool_calls=[("log_food", json.dumps({"food": "banana", "quantity": 1, "unit": "piece", "meal": "breakfast"}))]),
        gemini_reply("Added a banana to breakfast."),
    ]
    body = client.post("/api/assistant/messages", json={"text": "log a banana for breakfast"}, headers=auth).json()
    [action] = body["answer"]["actions"]
    assert action["kind"] == "food" and "breakfast" in action["summary"] and action["undo"]


def test_gemini_bad_tool_arguments_are_reported_to_the_model(client, auth, gemini):
    gemini.replies = [
        gemini_reply(tool_calls=[("get_recent_workouts", "not json"), ("make_coffee", "{}")]),
        gemini_reply("No workouts logged recently."),
    ]
    assert ask(client, auth).status_code == 200
    results = [m for m in gemini.requests[1]["messages"] if m["role"] == "tool"]
    assert len(results) == 2 and results[1]["content"].startswith("Error: There is no tool called make_coffee")


def test_gemini_out_of_quota_falls_back_then_says_so(client, auth, session, gemini):
    gemini.replies = [quota_error(), gemini_reply("Answered by the fallback model.", model="gemini-3.1-flash-lite")]
    assert ask(client, auth).json()["answer"]["text"] == "Answered by the fallback model."
    assert [r["model"] for r in gemini.requests] == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]

    gemini.requests.clear()
    gemini.replies = [quota_error(), quota_error()]
    r = ask(client, auth)
    assert r.status_code == 429 and "free questions" in r.json()["detail"]
    assert len(session.exec(select(ChatMessage)).all()) == 2  # only the first, answered question is saved


def test_gemini_stays_on_the_fallback_for_the_rest_of_the_question(client, auth, gemini):
    gemini.replies = [
        quota_error(),
        gemini_reply(tool_calls=[("get_profile", "{}")], model="gemini-3.1-flash-lite"),
        gemini_reply("Done.", model="gemini-3.1-flash-lite"),
    ]
    assert ask(client, auth).status_code == 200
    assert [r["model"] for r in gemini.requests] == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite"]


@pytest.mark.parametrize(
    "response, status, words",
    [
        (httpx.Response(400, json=[{"error": {"message": "API key not valid"}}]), 502, "API key not valid"),
        (httpx.Response(403, json={"error": {"message": "denied"}}), 502, "GEMINI_API_KEY"),
    ],
)
def test_gemini_errors_are_plain_and_save_nothing(client, auth, session, gemini, response, status, words):
    gemini.replies = [response]
    r = ask(client, auth)
    assert r.status_code == status and words in r.json()["detail"]
    assert session.exec(select(ChatMessage)).all() == []


def test_gemini_high_demand_is_retried_then_falls_back(client, auth, session, gemini):
    """Google's 503 "high demand" is common and short: try again, then the fallback model, then say it's busy."""
    gemini.replies = [busy_error(), gemini_reply("Second try worked.")]
    assert ask(client, auth).json()["answer"]["text"] == "Second try worked."
    assert [r["model"] for r in gemini.requests] == ["gemini-3.5-flash-lite"] * 2

    gemini.requests.clear()
    gemini.replies = [busy_error(), busy_error(), gemini_reply("The fallback answered.", model="gemini-3.1-flash-lite")]
    assert ask(client, auth).json()["answer"]["text"] == "The fallback answered."
    assert [r["model"] for r in gemini.requests] == ["gemini-3.5-flash-lite"] * 2 + ["gemini-3.1-flash-lite"]

    gemini.replies = [busy_error(), busy_error(), busy_error()]
    r = ask(client, auth)
    assert r.status_code == 503 and "busy" in r.json()["detail"]
    assert len(session.exec(select(ChatMessage)).all()) == 4  # the two answered questions only


def test_gemini_unreachable_and_cut_off(client, auth, gemini):
    gemini.down = True
    r = ask(client, auth)
    assert r.status_code == 502 and "internet" in r.json()["detail"]
    gemini.down = False
    gemini.replies = [gemini_reply("Part one", finish="length")]
    assert "cut off" in ask(client, auth).json()["answer"]["text"]


def test_gemini_daily_limit_is_its_own(client, auth, gemini, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_daily_limit", 1)
    monkeypatch.setattr(get_settings(), "assistant_daily_limit", 50)
    gemini.replies = [gemini_reply("one")]
    assert ask(client, auth).status_code == 200
    r = ask(client, auth)
    assert r.status_code == 429 and "1 questions" in r.json()["detail"]


def test_gemini_without_a_key(client, auth):
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    app.dependency_overrides[get_assistant_backend] = lambda: assistant.GeminiBackend(http, URL, "", "gemini-3.5-flash-lite")
    status = client.get("/api/assistant", headers=auth).json()
    assert not status["configured"] and "aistudio.google.com" in status["problem"]
    assert ask(client, auth).status_code == 503


def test_gemini_in_arabic(client, auth, gemini):
    gemini.replies = [gemini_reply("نمت 7 ساعات.")]
    headers = {**auth, "Accept-Language": "ar"}
    status = client.get("/api/assistant", headers=headers).json()
    assert "Google Gemini" in status["disclaimer"] and "Google" in status["disclaimer"]
    client.post("/api/assistant/messages", json={"text": "كم نمت؟"}, headers=headers)
    assert "Arabic" in gemini.requests[0]["messages"][-1]["content"]  # told to reply in Arabic


def test_which_ai_answers_with_gemini(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "gemini_api_key", "AIza-test")
    assert chosen_provider() == "gemini"  # a Gemini key and no Claude key
    monkeypatch.setattr(s, "anthropic_api_key", "sk-test")
    assert chosen_provider() == "claude"  # Claude wins when both are set
    monkeypatch.setattr(s, "assistant_provider", "gemini")
    assert chosen_provider() == "gemini"


def test_real_backend_is_built_from_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "assistant_provider", "gemini")
    monkeypatch.setattr(s, "gemini_api_key", "k")
    backend = next(get_assistant_backend())
    assert isinstance(backend, assistant.GeminiBackend)
    assert (backend.model, backend.fallback_model, backend.url) == (s.gemini_model, s.gemini_fallback_model, s.gemini_url)
