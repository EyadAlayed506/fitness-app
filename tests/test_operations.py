"""Running the pilot server (BE-03): safe settings, health check, backups, and upgrading an existing database."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app import models  # noqa: F401  (register tables)
from app.backup import BackupError, check_backup, create_backup, list_backups, restore_backup, sqlite_path
from app.config import DEFAULT_JWT_SECRET, Settings
from app.database import add_missing_columns, get_session
from app.main import app
from app.models.user import User
from app.security import hash_password
from app.startup_checks import pilot_server_problems, pilot_server_warnings

STRONG = "x" * 40


# ---------- start-up safety ----------

def settings(**kw) -> Settings:
    base = {"allow_signup": False, "jwt_secret": STRONG, "pilot_accounts": "a@b.co:long-pass-1", "jwt_expire_minutes": 10080}
    return Settings(_env_file=None, **{**base, **kw})


def test_dev_machine_has_no_pilot_checks():
    assert pilot_server_problems(Settings(_env_file=None, allow_signup=True, jwt_secret=DEFAULT_JWT_SECRET)) == []


def test_safe_pilot_settings_start():
    assert pilot_server_problems(settings()) == []
    assert pilot_server_warnings(settings()) == []


@pytest.mark.parametrize("overrides, problem", [
    ({"jwt_secret": DEFAULT_JWT_SECRET}, "example value"),
    ({"jwt_secret": "change-me-to-a-long-random-string"}, "example value"),  # the .env.example value
    ({"jwt_secret": "short-secret"}, "shorter than 32"),
    ({"pilot_accounts": ""}, "PILOT_ACCOUNTS is empty"),
])
def test_unsafe_pilot_settings_refuse_to_start(overrides, problem):
    problems = pilot_server_problems(settings(**overrides))
    assert len(problems) == 1 and problem in problems[0]


def test_short_sessions_are_a_warning():
    assert "logged out often" in pilot_server_warnings(settings(jwt_expire_minutes=30))[0]


# ---------- health ----------

def test_health_reports_versions_only(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["database"] == "ok" and body["version"] == "0.1.0"
    assert body["evidence_retrieval"] == "disabled"
    assert set(body) == {"status", "database", "version", "commit", "evidence_retrieval"}  # nothing secret


# ---------- backups ----------

def make_data(tmp_path):
    db, photos = tmp_path / "fitness.db", tmp_path / "data" / "photos"
    con = sqlite3.connect(db)
    con.execute("create table t (x text)")
    con.execute("insert into t values ('original')")
    con.commit()
    con.close()
    (photos / "7").mkdir(parents=True)
    (photos / "7" / "machine.jpg").write_bytes(b"jpeg")
    return db, photos


def value(db):
    con = sqlite3.connect(db)
    try:
        return con.execute("select x from t").fetchone()[0]
    finally:
        con.close()


def test_backup_and_restore_round_trip(tmp_path):
    db, photos = make_data(tmp_path)
    now = datetime(2026, 11, 16, 3, 0, tzinfo=UTC)
    backup = create_backup(db, photos, tmp_path / "backups", now=now)
    info = check_backup(backup)
    assert backup.name == "fitness-20261116-030000" and info["integrity_now"] == "ok" and info["photos_now"] == 1

    con = sqlite3.connect(db)
    con.execute("update t set x = 'changed'")
    con.commit()
    con.close()
    (photos / "7" / "machine.jpg").unlink()

    with pytest.raises(BackupError, match="--force"):
        restore_backup(backup, db, photos)
    moved = restore_backup(backup, db, photos, force=True, now=now)

    assert value(db) == "original"
    assert (photos / "7" / "machine.jpg").read_bytes() == b"jpeg"
    # the replaced data is kept beside it, never deleted
    assert {p.name for p in moved} == {"fitness.db.before-restore-20261116-030000", "photos.before-restore-20261116-030000"}
    assert value(tmp_path / "fitness.db.before-restore-20261116-030000") == "changed"


def test_restore_onto_a_new_machine(tmp_path):
    db, photos = make_data(tmp_path)
    backup = create_backup(db, photos, tmp_path / "backups")
    new = tmp_path / "new-pc"
    assert restore_backup(backup, new / "fitness.db", new / "photos") == []
    assert value(new / "fitness.db") == "original" and (new / "photos" / "7" / "machine.jpg").exists()


def test_old_backups_are_pruned_and_unfinished_ones_ignored(tmp_path):
    db, photos = make_data(tmp_path)
    dest = tmp_path / "backups"
    start = datetime(2026, 11, 16, 3, 0, tzinfo=UTC)
    for day in range(4):
        create_backup(db, photos, dest, keep=2, now=start + timedelta(days=day))
    (dest / "fitness-20261121-030000.partial").mkdir()
    assert [p.name for p in list_backups(dest)] == ["fitness-20261118-030000", "fitness-20261119-030000"]


def test_only_sqlite_files_can_be_backed_up(tmp_path):
    assert sqlite_path("sqlite:///./fitness.db").name == "fitness.db"
    for url in ("postgresql+psycopg://u:p@localhost/fitness", "sqlite://"):
        with pytest.raises(BackupError):
            sqlite_path(url)
    with pytest.raises(BackupError, match="No database"):
        create_backup(tmp_path / "missing.db", tmp_path / "photos", tmp_path / "backups")


# ---------- upgrading a database made before BE-02 ----------

OLD_USER_TABLE = """
CREATE TABLE user (
    id INTEGER PRIMARY KEY, email VARCHAR NOT NULL UNIQUE, hashed_password VARCHAR NOT NULL,
    marketing_opt_in BOOLEAN NOT NULL, marketing_consented_at DATETIME, unsubscribe_token VARCHAR NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
)"""


def test_database_from_before_pilot_accounts_upgrades_and_users_still_log_in(tmp_path):
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute(OLD_USER_TABLE)
    con.execute(
        "INSERT INTO user VALUES (1, 'old@example.com', ?, 0, NULL, 'tok', '2026-10-01 10:00:00')",
        (hash_password("secret123"),),
    )
    con.commit()
    con.close()

    engine = create_engine(f"sqlite:///{db}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)  # what start-up does
    added = add_missing_columns(engine)
    assert {"user.disabled_at", "user.token_version"} <= set(added)
    assert add_missing_columns(engine) == []  # running again changes nothing

    with Session(engine) as session:
        user = session.exec(select(User)).one()
        assert user.email == "old@example.com" and user.disabled_at is None and user.token_version is None
        app.dependency_overrides[get_session] = lambda: session
        try:
            client = TestClient(app)
            r = client.post("/api/auth/login", data={"username": "old@example.com", "password": "secret123"})
            assert r.status_code == 200, r.text
            me = client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
            assert me.status_code == 200 and me.json()["email"] == "old@example.com"
        finally:
            app.dependency_overrides.clear()
