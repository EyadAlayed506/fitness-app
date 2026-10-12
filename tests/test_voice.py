"""Hands-free: the AI fallback for spoken workout commands the app's own parser couldn't read.

The AI is a scripted fake (Claude or Ollama); these tests check what's sent, and that its answer is checked.
"""

import json

from app.services.voice import clean_command
from tests.test_assistant import claude, ollama, ollama_reply, reply, tool_use  # noqa: F401 (fixtures)


def interpret(client, auth, text, **extra):
    body = {"text": text, "current_exercise": "Leg Press", "plan": ["Leg Press", "Lat Pulldown"], "unit": "kg", **extra}
    return client.post("/api/voice/interpret", json=body, headers=auth)


def test_claude_reads_a_command(client, auth, claude):
    claude.replies = [reply(tool_use("command", {"intent": "log_set", "exercise": None, "set_number": None, "reps": 11,
                                                  "weight": 40, "unit": "kg", "seconds": None, "text": None}), stop="tool_use")]
    r = interpret(client, auth, "put me down for eleven with the forty")
    assert r.status_code == 200, r.text
    assert r.json()["command"] == {"intent": "log_set", "exercise": None, "setNumber": None, "count": 1, "reps": 11,
                                   "weight": 40.0, "unit": "kg", "bodyweight": False}
    request = claude.requests[0]
    assert request["tool_choice"] == {"type": "tool", "name": "command"}
    prompt = request["messages"][0]["content"]
    assert "Leg Press" in prompt and "put me down for eleven with the forty" in prompt


def test_ollama_reads_a_command_with_a_json_schema(client, auth, ollama):
    ollama.replies = [ollama_reply(json.dumps({"intent": "rest_extend", "exercise": None, "set_number": None, "reps": None,
                                               "weight": None, "unit": None, "seconds": 45, "text": None}))]
    r = interpret(client, auth, "chuck another three quarters of a minute on there")
    assert r.json()["command"] == {"intent": "rest_extend", "seconds": 45}
    sent = ollama.requests[0]
    assert sent["format"]["properties"]["intent"]["enum"][0] == "log_set" and "tools" not in sent


def test_not_a_command_or_nonsense_is_none(client, auth, ollama):
    ollama.replies = [ollama_reply(json.dumps({"intent": "unknown"})), ollama_reply("not json at all")]
    assert interpret(client, auth, "what a nice day").json() == {"command": None}
    assert interpret(client, auth, "blah").json() == {"command": None}


def test_ai_answers_are_checked():
    # numbers out of range are dropped; a set with nothing usable is no command
    assert clean_command({"intent": "log_set", "reps": 900, "weight": 2000, "unit": "kg"}) is None
    assert clean_command({"intent": "log_set", "reps": 10, "weight": 2000, "unit": "kg"})["weight"] is None
    assert clean_command({"intent": "rest_start", "seconds": 99999}) == {"intent": "rest_start", "seconds": None}
    assert clean_command({"intent": "rest_set_total", "seconds": -30}) is None
    assert clean_command({"intent": "note", "text": "  "}) is None
    assert clean_command({"intent": "note", "text": "left knee clicks"}) == {"intent": "note", "text": "left knee clicks"}
    assert clean_command({"intent": "drop_database"}) is None
    assert clean_command("rest") is None


def test_no_ai_available(client, auth, ollama):
    ollama.down = True
    r = interpret(client, auth, "something odd")
    assert r.status_code == 503 and "Ollama" in r.json()["detail"]
    assert client.post("/api/voice/interpret", json={"text": ""}, headers=auth).status_code == 422
