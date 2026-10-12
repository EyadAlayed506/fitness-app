"""Users pick the weekdays they train; the plan and everything else follow those days."""

from tests.conftest import PROFILE, signup_and_login

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


def save(client, headers, **changes):
    return client.put("/api/me/profile", json={**PROFILE, **changes}, headers=headers)


def test_chosen_days_are_stored_and_used(client):
    headers = signup_and_login(client)
    r = save(client, headers, training_days=[SUN, TUE, THU])
    assert r.status_code == 200, r.text
    profile = r.json()
    assert profile["training_days"] == [TUE, THU, SUN] and profile["days_per_week"] == 3
    assert profile["training_days_chosen"] is True
    # still there when the app is opened again
    assert client.get("/api/me/profile", headers=headers).json()["training_days"] == [TUE, THU, SUN]
    routine = client.get("/api/me/routine", headers=headers).json()
    assert [d["weekday"] for d in routine["days"]] == ["Tuesday", "Thursday", "Sunday"]
    assert "Monday" in routine["rest_days"] and "Wednesday" in routine["rest_days"]


def test_changing_days_keeps_workout_history(client):
    headers = signup_and_login(client)
    save(client, headers, training_days=[SUN, TUE, THU])
    press = client.get("/api/exercises/qr/chest-press", headers=headers).json()
    w = client.post("/api/workouts", json={}, headers=headers).json()
    client.post(f"/api/workouts/{w['id']}/sets", json={"exercise_id": press["id"], "reps": 8, "weight": 40}, headers=headers)
    client.patch(f"/api/workouts/{w['id']}", json={"finish": True}, headers=headers)

    save(client, headers, training_days=[MON, THU, SAT])
    routine = client.get("/api/me/routine", headers=headers).json()
    assert [d["weekday"] for d in routine["days"]] == ["Monday", "Thursday", "Saturday"]
    history = client.get("/api/workouts", headers=headers).json()
    assert len(history) == 1 and history[0]["set_count"] == 1


def test_invalid_days_are_refused(client):
    headers = signup_and_login(client)
    for bad in ([], [0, 0], [8], list(range(7))):
        r = save(client, headers, training_days=bad)
        assert r.status_code == 422, bad


def test_single_and_consecutive_days(client):
    headers = signup_and_login(client)
    save(client, headers, training_days=[WED])
    assert client.get("/api/me/routine", headers=headers).json()["split"] == "Full body"
    save(client, headers, training_days=[SAT, SUN, MON])
    routine = client.get("/api/me/routine", headers=headers).json()
    titles = {d["weekday"]: d["title"] for d in routine["days"]}
    assert titles == {"Saturday": "Full body", "Sunday": "Full body", "Monday": "Full body"}
    assert routine["warnings"]  # back-to-back full-body days come with a note, never a block


def test_custom_schedule(client):
    """The user picks a session type and/or name for each day; the recommendation stays one tap away."""
    headers = signup_and_login(client)
    save(client, headers, training_days=[MON, WED, FRI])
    body = {"days": [
        {"weekday": MON, "focus": "full_body"},
        {"weekday": WED, "focus": "full_body", "name": "Heavy day"},
        {"weekday": FRI, "focus": "upper", "name": "  Arms   & chest "},
    ]}
    preview = client.post("/api/me/schedule/preview", json=body, headers=headers).json()
    assert [d["title"] for d in preview["days"]] == ["Full body", "Heavy day", "Arms & chest"]
    # a preview isn't saved
    assert client.get("/api/me/routine", headers=headers).json()["customized"] is False

    saved = client.put("/api/me/schedule", json=body, headers=headers).json()
    assert [d["focus"] for d in saved["days"]] == ["full_body", "full_body", "upper"]
    assert [d["recommended_focus"] for d in saved["days"]] == ["full_body"] * 3
    assert saved["customized"] and saved["recommended_split"] == "Full body x3"
    assert {o["value"] for o in saved["focus_options"]} == {"full_body", "upper", "lower", "push", "pull", "legs"}
    again = client.get("/api/me/routine", headers=headers).json()
    assert [d["title"] for d in again["days"]] == ["Full body", "Heavy day", "Arms & chest"]

    # changing the days in the profile keeps the choices for the days that stay
    save(client, headers, training_days=[MON, FRI, SAT])
    routine = client.get("/api/me/routine", headers=headers).json()
    assert {d["weekday"]: d["title"] for d in routine["days"]} == {
        "Monday": "Full body", "Friday": "Arms & chest", "Saturday": "Full body",
    }

    # the schedule editor can change the days too
    moved = client.put("/api/me/schedule", json={"days": [{"weekday": TUE}, {"weekday": THU, "focus": "legs"}]}, headers=headers)
    assert [(d["weekday"], d["focus"]) for d in moved.json()["days"]] == [("Tuesday", "full_body"), ("Thursday", "legs")]
    assert client.get("/api/me/profile", headers=headers).json()["training_days"] == [TUE, THU]

    # reject the custom plan: back to the recommendation, same days
    reset = client.delete("/api/me/schedule/custom", headers=headers).json()
    assert [d["focus"] for d in reset["days"]] == ["full_body", "full_body"] and not reset["customized"]


def test_custom_schedule_is_validated(client):
    headers = signup_and_login(client)
    save(client, headers, training_days=[MON, WED])
    for body in (
        {"days": [{"weekday": MON, "focus": "cardio"}]},
        {"days": [{"weekday": MON}, {"weekday": MON}]},
        {"days": []},
        {"days": [{"weekday": MON, "name": "x" * 41}]},
        {"days": [{"weekday": 9}]},
    ):
        assert client.put("/api/me/schedule", json=body, headers=headers).status_code == 422, body


def test_older_client_sending_only_a_count(client):
    headers = signup_and_login(client)
    profile = save(client, headers).json()  # PROFILE has days_per_week=4 and no days
    assert profile["training_days_chosen"] is False
    assert profile["training_days"] == [MON, TUE, THU, FRI]  # the old defaults, shown as "set automatically"
    # the user picks days in the new app; an older client saving the same count keeps them
    save(client, headers, training_days=[TUE, WED, SAT, SUN])
    kept = save(client, headers).json()
    assert kept["training_days"] == [TUE, WED, SAT, SUN] and kept["training_days_chosen"] is True
    # an older client changing the count replaces them with defaults for the new count
    changed = save(client, headers, days_per_week=2).json()
    assert changed["training_days"] == [MON, THU] and changed["training_days_chosen"] is False
