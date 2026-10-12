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
from app.routers.assistant import get_assistant_client
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
    app.dependency_overrides[get_assistant_client] = lambda: fake
    return fake


def ask(client, auth, question="How did I sleep?"):
    return client.post("/api/assistant/messages?tz_offset=0", json={"text": question}, headers=auth)


def tool_results(request: dict) -> list[dict]:
    return [b for b in request["messages"][-1]["content"] if isinstance(b, dict) and b.get("type") == "tool_result"]


def test_not_set_up_without_an_api_key(client, auth):
    status = client.get("/api/assistant", headers=auth).json()
    assert status["configured"] is False and status["messages"] == []
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
