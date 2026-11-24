"""Ask the coach every evaluation case (tests/coach_cases.json) on the real AI model and record what it did.

Run (with Ollama running and the model pulled, or a Claude key in .env):

    uv run python -m app.coach_eval                    # every case, English and Arabic
    uv run python -m app.coach_eval --only action-sets --lang ar
    uv run python -m app.coach_eval --list             # case ids

Each case and language gets its own throwaway database in memory, with the case's data (fixtures in
coach_cases.json), so cases don't affect each other and nothing touches fitness.db. The model is the one
the server would use (ASSISTANT_PROVIDER, OLLAMA_MODEL, ... from .env).

Results go to coach-eval-results/<time>-<model>.json and .md: per case the reply, tools used, actions,
seconds to answer, and automatic checks (tools, number of actions, reply language). The reply rubric in
each case's "expect" is scored by a person afterwards.
"""

import argparse
import datetime as dt
import hashlib
import json
import platform
import re
import subprocess
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app import models  # noqa: F401  (register tables)
from app.config import get_settings
from app.database import get_session
from app.models.sleep import SleepEntry
from app.models.user import Profile, User
from app.models.workout import WorkoutSession, WorkoutSet
from app.seed import seed_catalogue
from app.services import assistant

ROOT = Path(__file__).resolve().parent.parent
CASES_FILE = ROOT / "tests" / "coach_cases.json"
OUT_DIR = ROOT / "coach-eval-results"
LANGS = ("en", "ar")
ARABIC = re.compile(r"[؀-ۿ]")
LATIN = re.compile(r"[A-Za-z]")
PASSWORD = "eval-pass-123"

PROFILE = {
    "birth_date": "1996-05-20", "sex": "male", "height": 180, "height_unit": "cm", "weight": 95, "weight_unit": "kg",
    "activity_level": "moderate", "goal": "auto", "diet_option": "normal", "days_per_week": 4,
    "minutes_per_session": 60, "equipment": "gym",
}


def load_cases() -> dict:
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))


def today() -> dt.date:
    return dt.datetime.now(dt.UTC).date()  # questions are sent with tz_offset=0


# ---------- the cases' data ----------


def signup(client: TestClient, email: str) -> dict:
    r = client.post("/api/auth/signup", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    r = client.post("/api/auth/login", data={"username": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.put("/api/me/profile", json=PROFILE, headers=headers)
    assert r.status_code == 200, r.text
    return headers


def _user(session: Session, email: str) -> User:
    return session.exec(select(User).where(User.email == email)).one()


def _ctx(session: Session, user: User, question: str | None) -> assistant.ToolContext:
    return assistant.ToolContext(session=session, user=user, profile=session.get(Profile, user.id), tz_offset=0,
                                 question=question)


def _sleep(session: Session, user: User, day: dt.date, minutes: int) -> None:
    wake = dt.datetime.combine(day, dt.time(7))
    session.add(SleepEntry(user_id=user.id, date=day, bedtime=wake - dt.timedelta(minutes=minutes), wake_time=wake,
                           duration_minutes=minutes, source="manual"))
    session.commit()


def _workout(session: Session, user: User, day: dt.date, sets: list[tuple[int, int, float]]) -> None:
    start = dt.datetime.combine(day, dt.time(12, tzinfo=dt.UTC))
    w = WorkoutSession(user_id=user.id, started_at=start, ended_at=start + dt.timedelta(hours=1))
    session.add(w)
    session.commit()
    for i, (exercise_id, reps, weight) in enumerate(sets):
        session.add(WorkoutSet(session_id=w.id, exercise_id=exercise_id, set_number=i + 1, reps=reps, weight_kg=weight))
    session.commit()


def build_fixture(name: str, client: TestClient, session: Session, email: str) -> dict:
    """The case's data for the signed-up user `email` (see "fixtures" in coach_cases.json).
    Returns the values for {placeholders} in the cases' scripts."""
    from app.routers.exercises import search_exercises

    day = today()
    values = {"today": day.isoformat(), "yesterday": (day - dt.timedelta(days=1)).isoformat()}
    user = _user(session, email)
    if name == "week":
        _sleep(session, user, day, 6 * 60 + 30)
        _, err = assistant.run_tool(_ctx(session, user, "breakfast"), "log_food", {"food": "banana"})
        assert not err
        bench = search_exercises(user, session, search="bench press", muscle_group=None, limit=1)[0]
        _workout(session, user, day - dt.timedelta(days=1), [(bench.id, 8, 60)] * 3)
    elif name == "other_user":
        signup(client, "other@example.com")
        other = _user(session, "other@example.com")
        _sleep(session, other, day, 9 * 60)
        content, err = assistant.run_tool(_ctx(session, other, "lunch"), "log_food", {"food": "banana"})
        assert not err
        values["other_food_entry"] = json.loads(content)["logged"]["id"]
    elif name != "fresh":
        raise ValueError(f"Unknown fixture {name}")
    return values


# ---------- asking ----------


def arabic_share(text: str) -> float:
    """Arabic letters among all Arabic and Latin letters (food and exercise names may stay in English)."""
    ar, la = len(ARABIC.findall(text)), len(LATIN.findall(text))
    return ar / (ar + la) if ar + la else 0.0


def ask_case(app, case: dict, lang: str) -> dict:
    """One case in one language, on a fresh in-memory database."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalogue(session)
        app.dependency_overrides[get_session] = lambda: session
        try:
            client = TestClient(app)
            email = "tester@example.com"
            headers = signup(client, email)
            build_fixture(case["fixture"], client, session, email)
            app_lang = case.get("app_language_override", {}).get(lang, lang)
            question = case["message"][lang]
            started = time.perf_counter()
            r = client.post("/api/assistant/messages?tz_offset=0", json={"text": question},
                            headers={**headers, "Accept-Language": app_lang})
            seconds = round(time.perf_counter() - started, 1)
        finally:
            app.dependency_overrides.pop(get_session, None)
    expect = case["expect"]
    result = {"id": case["id"], "category": case["category"], "lang": lang, "app_language": app_lang,
              "question": question, "status": r.status_code, "seconds": seconds, "rubric": expect["reply"]}
    if r.status_code != 200:
        result.update(reply=None, error=r.json().get("detail", r.text), tools_used=[], actions=[], checks={})
        return result
    answer = r.json()["answer"]
    share = arabic_share(answer["text"])
    tools_any = expect.get("tools_any")
    result.update(
        reply=answer["text"], tools_used=answer["tools_used"], actions=[a["summary"] for a in answer["actions"]],
        arabic_share=round(share, 2),
        checks={
            "tools": None if not tools_any else any(t in answer["tools_used"] for t in tools_any),
            "actions": len(answer["actions"]) == expect["actions"],
            "language": share >= 0.5 if lang == "ar" else share < 0.5,  # the language the user wrote in
        },
    )
    return result


def gpu() -> str:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown (no nvidia-smi)"


def run_info() -> dict:
    from app.routers.assistant import chosen_provider
    from app.startup_checks import current_commit

    s = get_settings()
    provider = chosen_provider()
    return {
        "started": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "commit": current_commit(),
        "provider": provider,
        "model": s.ollama_model if provider == "ollama" else s.assistant_model,
        "ollama_num_ctx": s.ollama_num_ctx if provider == "ollama" else None,
        "prompt_sha256_12": hashlib.sha256(assistant.SYSTEM_PROMPT.encode()).hexdigest()[:12],
        "cases_version": load_cases()["version"],
        "gpu": gpu(),
        "machine": f"{platform.system()} {platform.release()}, {platform.processor() or platform.machine()}",
    }


def markdown(info: dict, results: list[dict]) -> str:
    def mark(v):
        return "–" if v is None else ("✅" if v else "❌")

    lines = ["# Coach evaluation run", ""]
    lines += [f"- **{k}:** {v}" for k, v in info.items()]
    ok = [r for r in results if r["status"] == 200]
    if ok:
        secs = sorted(r["seconds"] for r in ok)
        lines.append(f"- **seconds per answer:** median {secs[len(secs) // 2]}, max {secs[-1]}")
    lines += ["", "| Case | Lang | s | Tools | Actions | Language | Tools used | Actions done |",
              "|---|---|---|---|---|---|---|---|"]
    for r in results:
        c = r["checks"]
        lines.append(f"| {r['id']} | {r['lang']} | {r['seconds']} | {mark(c.get('tools'))} | {mark(c.get('actions'))} | "
                     f"{mark(c.get('language'))} | {', '.join(r['tools_used'])} | {'; '.join(r['actions'])} |")
    lines += ["", "## Replies (score each against its rubric)", ""]
    for r in results:
        lines += [f"### {r['id']} ({r['lang']}, app in {r['app_language']})", "", f"**Q:** {r['question']}", ""]
        lines += [f"**Error {r['status']}:** {r['error']}"] if r["reply"] is None else ["**A:**", "", r["reply"]]
        lines += ["", "Rubric: " + " / ".join(r["rubric"]), "", "Score (pass / partly / fail), notes:", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ask the coach every evaluation case on the real model.")
    parser.add_argument("--only", nargs="*", help="case ids to run (default: all)")
    parser.add_argument("--lang", choices=LANGS, help="one language only (default: both)")
    parser.add_argument("--list", action="store_true", help="list the case ids and stop")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):  # Arabic error texts in a Windows console
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    cases = [c for c in load_cases()["cases"] if "covered_by" not in c]  # failures are tested offline
    if args.list:
        for c in cases:
            print(f"{c['id']:32} {c['category']}")
        return 0
    if args.only:
        unknown = set(args.only) - {c["id"] for c in cases}
        if unknown:
            print(f"Unknown case ids: {', '.join(sorted(unknown))}. See --list.")
            return 2
        cases = [c for c in cases if c["id"] in args.only]

    from app.main import app

    get_settings().allow_signup = True  # throwaway in-memory accounts, whatever the .env says
    from app.routers.assistant import get_assistant_backend

    backends = get_assistant_backend()  # keep the generator: its HTTP client closes when it's dropped
    problem = next(backends).problem()
    backends.close()
    if problem:
        print(f"The coach can't answer yet: {problem}")
        return 1

    info = run_info()
    print(f"Coach: {info['provider']} {info['model']} | GPU: {info['gpu']}")
    langs = [args.lang] if args.lang else list(LANGS)
    results = []
    total = len(cases) * len(langs)
    for case in cases:
        for lang in langs:
            print(f"[{len(results) + 1}/{total}] {case['id']} ({lang}) ...", end=" ", flush=True)
            r = ask_case(app, case, lang)
            results.append(r)
            print(f"{r['seconds']} s" if r["status"] == 200 else f"error {r['status']}: {r['error']}")
    info["finished"] = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")

    OUT_DIR.mkdir(exist_ok=True)
    stem = f"{dt.datetime.now():%Y%m%d-%H%M}-{re.sub(r'[^A-Za-z0-9.-]', '_', info['model'])}"
    (OUT_DIR / f"{stem}.json").write_text(json.dumps({"run": info, "results": results}, ensure_ascii=False, indent=2),
                                          encoding="utf-8")
    (OUT_DIR / f"{stem}.md").write_text(markdown(info, results), encoding="utf-8")
    passed = sum(all(v is not False for v in r["checks"].values()) and r["status"] == 200 for r in results)
    print(f"\nAutomatic checks passed: {passed}/{len(results)}. Results: {OUT_DIR / stem}.json and .md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
