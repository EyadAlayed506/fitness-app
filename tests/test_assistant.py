"""The assistant, with a scripted fake in place of the Claude API (no network, no cost)."""

import datetime as dt
import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from sqlmodel import select

from app.config import get_settings
from app.main import app
from app.models.assistant import ChatMessage
from app.models.user import Profile, User
from app.routers.assistant import chosen_provider, get_assistant_backend
from app.services import assistant
from tests.conftest import PROFILE, add_sleep, signup_and_login

TODAY = dt.date.today()


def text(t: str):
    return SimpleNamespace(type="text", text=t)


def tool_use(name: str, args: dict | None = None, id: str = "tu_1"):
    return SimpleNamespace(type="tool_use", id=id, name=name, input=args or {})


def reply(*blocks, stop="end_turn"):
    return SimpleNamespace(content=list(blocks), stop_reason=stop)


class FakeClaude:
    """Returns the scripted replies in order and records every request."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        # copy the messages: the loop keeps appending to the same list
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        item = self.replies.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def claude(client):
    fake = FakeClaude()
    app.dependency_overrides[get_assistant_backend] = lambda: assistant.ClaudeBackend(fake, get_settings().assistant_model)
    return fake


def ask(client, auth, question="How did I sleep?"):
    return client.post("/api/assistant/messages?tz_offset=0", json={"text": question}, headers=auth)


def tool_results(request: dict) -> list[dict]:
    return [b for b in request["messages"][-1]["content"] if isinstance(b, dict) and b.get("type") == "tool_result"]


def test_not_set_up_without_an_api_key(client, auth):
    status = client.get("/api/assistant", headers=auth).json()
    assert status["configured"] is False and status["messages"] == [] and status["provider"] == "claude"
    assert "ANTHROPIC_API_KEY" in status["problem"]
    r = ask(client, auth)
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_answer_uses_the_users_own_data(client, auth, session, claude):
    user = session.exec(select(User)).one()
    add_sleep(session, user, TODAY, 6 * 60 + 30, source="whoop")
    claude.replies = [
        reply(text("Let me check."), tool_use("get_sleep", {"days": 7}), stop="tool_use"),
        reply(text("You slept 6 h 30 min last night, under your 7 h goal.")),
    ]
    r = ask(client, auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"]["text"].startswith("You slept 6 h 30 min")
    assert body["answer"]["tools_used"] == ["get_sleep"]
    assert body["question"]["text"] == "How did I sleep?"

    first, second = claude.requests
    assert first["model"] == get_settings().assistant_model
    assert {t["name"] for t in first["tools"]} == set(assistant.TOOLS_BY_NAME)
    assert first["system"][0]["text"] == assistant.SYSTEM_PROMPT  # stable, cacheable
    assert first["system"][0]["cache_control"] == {"type": "ephemeral"}
    note = first["messages"][-1]["content"][1]["text"]
    assert TODAY.isoformat() in note and "metric" in note
    result = tool_results(second)[0]
    assert result["tool_use_id"] == "tu_1" and result["is_error"] is False
    nights = json.loads(result["content"])["nights"]
    assert nights[-1]["main_minutes"] == 390 and nights[-1]["source"] == "whoop"

    # the conversation is kept and sent with the next question
    claude.replies = [reply(text("Aim for 7 hours."))]
    ask(client, auth, "What should I do?")
    history = claude.requests[-1]["messages"]
    assert [m["role"] for m in history] == ["user", "assistant", "user"]
    assert history[1]["content"].startswith("You slept")
    status = client.get("/api/assistant", headers=auth).json()
    assert [m["role"] for m in status["messages"]] == ["user", "assistant", "user", "assistant"]


def test_tools_only_see_the_logged_in_user(client, auth, session, claude):
    other = signup_and_login(client, email="other@example.com")
    client.put("/api/me/profile", json=PROFILE, headers=other)
    other_user = session.exec(select(User).where(User.email == "other@example.com")).one()
    add_sleep(session, other_user, TODAY, 9 * 60)
    claude.replies = [reply(tool_use("get_sleep", {"days": 3}), stop="tool_use"), reply(text("No sleep logged."))]
    ask(client, auth)
    nights = json.loads(tool_results(claude.requests[1])[0]["content"])["nights"]
    assert nights == [None, None, None]  # the other user's night isn't visible


@pytest.mark.parametrize("name", list(assistant.TOOLS_BY_NAME))
def test_every_tool_runs_on_a_fresh_account(client, auth, session, name):
    """No data logged yet: every tool still answers (empty, not an error), except exercise tools need a name."""
    user = session.exec(select(User)).one()
    ctx = assistant.ToolContext(session=session, user=user, profile=session.get(Profile, user.id), tz_offset=0)
    args = {"exercise": "leg press"} if "exercise" in name else {}
    content, is_error = assistant.run_tool(ctx, name, args)
    assert not is_error, content
    assert "cut short" not in content
    json.loads(content)


def test_tool_problems_are_reported_to_the_model(client, auth, session, claude):
    claude.replies = [
        reply(
            tool_use("get_exercise_info", {"exercise": "zzzz qqqq"}, id="a"),
            tool_use("delete_everything", {}, id="b"),
            tool_use("get_food_day", {"date": "yesterday"}, id="c"),
            stop="tool_use",
        ),
        reply(text("I couldn't find that exercise.")),
    ]
    assert ask(client, auth, "How do I do zzzz qqqq?").status_code == 200
    results = {r["tool_use_id"]: r for r in tool_results(claude.requests[1])}
    assert all(r["is_error"] for r in results.values())  # all three results go back in one message
    assert "No exercise" in results["a"]["content"]
    assert "no tool called delete_everything" in results["b"]["content"]
    assert "YYYY-MM-DD" in results["c"]["content"]


def test_a_runaway_loop_is_stopped(client, auth, claude):
    claude.replies = [reply(tool_use("get_points"), stop="tool_use")] * assistant.MAX_TOOL_ROUNDS
    r = ask(client, auth)
    assert r.status_code == 200 and "too many steps" in r.json()["answer"]["text"]
    assert len(claude.requests) == assistant.MAX_TOOL_ROUNDS


def test_refusal_and_cut_off_answers(client, auth, claude):
    claude.replies = [reply(stop="refusal")]
    assert "can't help" in ask(client, auth).json()["answer"]["text"]
    claude.replies = [reply(text("Part one"), stop="max_tokens")]
    assert "cut off" in ask(client, auth).json()["answer"]["text"]


def test_api_errors_save_nothing(client, auth, session, claude):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.replies = [anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=request), body=None)]
    r = ask(client, auth)
    assert r.status_code == 502 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    claude.replies = [anthropic.APIConnectionError(request=request)]
    assert ask(client, auth).status_code == 502
    assert session.exec(select(ChatMessage)).all() == []


def test_daily_limit_and_clearing(client, auth, claude, monkeypatch):
    monkeypatch.setattr(get_settings(), "assistant_daily_limit", 2)
    claude.replies = [reply(text("one")), reply(text("two"))]
    assert ask(client, auth).status_code == 200
    assert ask(client, auth).json()["messages_left_today"] == 0
    r = ask(client, auth)
    assert r.status_code == 429 and len(claude.requests) == 2  # no API call once the limit is reached
    assert client.delete("/api/assistant/messages", headers=auth).status_code == 204
    assert client.get("/api/assistant", headers=auth).json()["messages"] == []


def test_question_is_validated(client, auth, claude):
    assert client.post("/api/assistant/messages", json={"text": ""}, headers=auth).status_code == 422
    assert client.post("/api/assistant/messages", json={"text": "x" * 2001}, headers=auth).status_code == 422


def test_deleting_the_account_deletes_the_conversation(client, auth, session, claude):
    claude.replies = [reply(text("hi"))]
    ask(client, auth)
    assert client.delete("/api/me", headers=auth).status_code == 204
    assert session.exec(select(ChatMessage)).all() == []


# ---------- Ollama (a model on the user's own PC) ----------


class FakeOllama:
    """Answers /api/tags and /api/chat like Ollama, from a script, and records the chat requests."""

    def __init__(self, *replies, models=("qwen3:8b",), down=False):
        self.replies = list(replies)
        self.models = models
        self.down = down
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": m} for m in self.models]})
        body = json.loads(request.content)
        self.requests.append(body)
        item = self.replies.pop(0)
        return item if isinstance(item, httpx.Response) else httpx.Response(200, json=item)


def ollama_reply(content="", tool_calls=None, done_reason="stop"):
    message = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = [{"function": {"name": n, "arguments": a}} for n, a in tool_calls]
    return {"model": "qwen3:8b", "message": message, "done": True, "done_reason": done_reason}


@pytest.fixture
def ollama(client):
    fake = FakeOllama()
    http = httpx.Client(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_assistant_backend] = lambda: assistant.OllamaBackend(
        http, "http://localhost:11434", "qwen3:8b", 16384
    )
    return fake


def test_ollama_answers_from_the_users_data(client, auth, session, ollama):
    user = session.exec(select(User)).one()
    add_sleep(session, user, TODAY, 7 * 60 + 40)
    ollama.replies = [
        ollama_reply(tool_calls=[("get_sleep", {"days": 7})]),
        ollama_reply("<think>The user slept 7 h 40.</think>You slept 7 h 40 min last night, above your 7 h goal."),
    ]
    status = client.get("/api/assistant", headers=auth).json()
    assert status["configured"] and status["provider"] == "ollama" and status["model"] == "qwen3:8b"
    assert status["messages_left_today"] is None  # free: no daily limit

    body = ask(client, auth).json()
    assert body["answer"]["text"] == "You slept 7 h 40 min last night, above your 7 h goal."  # thinking removed
    assert body["answer"]["tools_used"] == ["get_sleep"] and body["messages_left_today"] is None

    first, second = ollama.requests
    assert first["model"] == "qwen3:8b" and first["stream"] is False and first["options"]["num_ctx"] == 16384
    assert first["messages"][0] == {"role": "system", "content": assistant.SYSTEM_PROMPT}
    assert TODAY.isoformat() in first["messages"][-1]["content"]
    assert {t["function"]["name"] for t in first["tools"]} == set(assistant.TOOLS_BY_NAME)
    assert all(t["type"] == "function" and "parameters" in t["function"] for t in first["tools"])
    tool_message = second["messages"][-1]
    assert tool_message["role"] == "tool" and tool_message["tool_name"] == "get_sleep"
    assert json.loads(tool_message["content"])["nights"][-1]["main_minutes"] == 460


def test_ollama_tool_arguments_as_text_and_errors(client, auth, ollama):
    ollama.replies = [
        ollama_reply(tool_calls=[("get_recent_workouts", '{"days": 3}'), ("make_coffee", {})]),
        ollama_reply("No workouts in the last 3 days."),
    ]
    assert ask(client, auth).status_code == 200
    results = [m for m in ollama.requests[1]["messages"] if m["role"] == "tool"]
    assert json.loads(results[0]["content"])["from"] == str(TODAY - dt.timedelta(days=2))
    assert results[1]["content"].startswith("Error: There is no tool called make_coffee")


def test_ollama_not_running_or_model_missing(client, auth, ollama):
    ollama.down = True
    status = client.get("/api/assistant", headers=auth).json()
    assert not status["configured"] and "Ollama isn't running" in status["problem"]
    r = ask(client, auth)
    assert r.status_code == 503 and "ollama.com" in r.json()["detail"]

    ollama.down, ollama.models = False, ("llama3.1:latest",)
    problem = client.get("/api/assistant", headers=auth).json()["problem"]
    assert problem == "The model qwen3:8b isn't downloaded yet. Open a terminal and run: ollama pull qwen3:8b"


def test_ollama_errors_and_cut_off_answers(client, auth, session, ollama):
    ollama.replies = [httpx.Response(500, json={"error": "out of memory"})]
    r = ask(client, auth)
    assert r.status_code == 502 and "out of memory" in r.json()["detail"]
    assert session.exec(select(ChatMessage)).all() == []
    ollama.replies = [ollama_reply("Part one", done_reason="length")]
    assert "cut off" in ask(client, auth).json()["answer"]["text"]


def test_ollama_has_no_daily_limit(client, auth, ollama, monkeypatch):
    monkeypatch.setattr(get_settings(), "assistant_daily_limit", 1)
    ollama.replies = [ollama_reply("one"), ollama_reply("two")]
    assert ask(client, auth).status_code == 200
    assert ask(client, auth).status_code == 200


def test_which_ai_answers(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "assistant_provider", "auto")
    monkeypatch.setattr(s, "anthropic_api_key", "")
    assert chosen_provider() == "ollama"  # free and local unless a Claude key is set
    monkeypatch.setattr(s, "anthropic_api_key", "sk-test")
    assert chosen_provider() == "claude"
    monkeypatch.setattr(s, "assistant_provider", "ollama")
    assert chosen_provider() == "ollama"
