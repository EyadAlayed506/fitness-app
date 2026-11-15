"""Back up and restore the pilot server's data: the SQLite database and the confirmed machine photos.

Run from the folder the server is started from (DATABASE_URL and PHOTOS_DIR are relative to it):

    uv run python -m app.backup create                 # into backups/, keeps the newest 14
    uv run python -m app.backup create --keep 30 --dest D:/fitness-backups
    uv run python -m app.backup check backups/fitness-20261116-030000
    uv run python -m app.backup restore backups/fitness-20261116-030000          # only into an empty spot
    uv run python -m app.backup restore backups/fitness-20261116-030000 --force  # stop the server first

The database copy uses SQLite's online backup, so `create` is safe while the server is running.
`restore --force` never deletes the current data: it is first moved aside to *.before-restore-<time>.
.env is not backed up here (it holds secrets); keep a private copy of it somewhere else.
PostgreSQL is not handled: use pg_dump for that.
"""

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.engine import make_url

PREFIX = "fitness-"
DB_FILE = "fitness.db"
PHOTOS = "photos"
MANIFEST = "manifest.json"


class BackupError(Exception):
    pass


def sqlite_path(database_url: str) -> Path:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        raise BackupError("Only a SQLite file database can be backed up with this command (use pg_dump for PostgreSQL)")
    return Path(url.database)


def _read_only(path: Path) -> str:
    # file:///C:/... on Windows, file:///home/... on Linux
    return path.resolve().as_uri() + "?mode=ro"


def _copy_sqlite(source: Path, target: Path) -> None:
    src = sqlite3.connect(_read_only(source), uri=True)
    try:
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def integrity(db: Path) -> str:
    con = sqlite3.connect(_read_only(db), uri=True)
    try:
        return con.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        con.close()


def _count_files(folder: Path) -> int:
    return sum(1 for p in folder.rglob("*") if p.is_file()) if folder.exists() else 0


def create_backup(db: Path, photos: Path, dest: Path, keep: int = 14, now: datetime | None = None) -> Path:
    if not db.exists():
        raise BackupError(f"No database at {db}")
    now = now or datetime.now(UTC)
    target = dest / f"{PREFIX}{now:%Y%m%d-%H%M%S}"
    if target.exists():
        raise BackupError(f"{target} already exists")
    tmp = target.with_name(target.name + ".partial")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    _copy_sqlite(db, tmp / DB_FILE)
    if photos.exists():
        shutil.copytree(photos, tmp / PHOTOS)
    check = integrity(tmp / DB_FILE)
    if check != "ok":
        raise BackupError(f"The copied database failed its integrity check: {check}")
    (tmp / MANIFEST).write_text(json.dumps({
        "created_at": now.isoformat(),
        "database": str(db),
        "database_bytes": (tmp / DB_FILE).stat().st_size,
        "photos": _count_files(tmp / PHOTOS),
        "integrity": check,
    }, indent=2))
    tmp.rename(target)  # a backup folder only appears once it is complete
    prune(dest, keep)
    return target


def list_backups(dest: Path) -> list[Path]:
    """Complete backups, oldest first."""
    if not dest.exists():
        return []
    return sorted(p for p in dest.iterdir() if p.is_dir() and p.name.startswith(PREFIX) and (p / MANIFEST).exists())


def prune(dest: Path, keep: int) -> list[Path]:
    if keep < 1:
        raise BackupError("--keep must be at least 1")
    old = list_backups(dest)[:-keep]
    for p in old:
        shutil.rmtree(p)
    return old


def check_backup(backup: Path) -> dict:
    if not (backup / MANIFEST).exists() or not (backup / DB_FILE).exists():
        raise BackupError(f"{backup} is not a complete backup")
    manifest = json.loads((backup / MANIFEST).read_text())
    manifest["integrity_now"] = integrity(backup / DB_FILE)
    manifest["photos_now"] = _count_files(backup / PHOTOS)
    return manifest


def restore_backup(backup: Path, db: Path, photos: Path, force: bool = False, now: datetime | None = None) -> list[Path]:
    """Put a backup back. Returns where the replaced data was moved (empty when nothing was there)."""
    info = check_backup(backup)
    if info["integrity_now"] != "ok":
        raise BackupError(f"The backup's database is damaged: {info['integrity_now']}")
    existing = [p for p in (db, photos) if p.exists()]
    if existing and not force:
        raise BackupError(
            "Data already exists at " + ", ".join(map(str, existing)) + ". Stop the server and use --force "
            "(the current data is kept beside it, not deleted)"
        )
    stamp = f"{(now or datetime.now(UTC)):%Y%m%d-%H%M%S}"
    moved = []
    for p in existing:
        aside = p.with_name(f"{p.name}.before-restore-{stamp}")
        p.rename(aside)
        moved.append(aside)
    db.parent.mkdir(parents=True, exist_ok=True)
    _copy_sqlite(backup / DB_FILE, db)
    if (backup / PHOTOS).exists():
        shutil.copytree(backup / PHOTOS, photos)
    return moved


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("create", help="make a backup now")
    c.add_argument("--dest", default="backups", help="folder for backups (default: backups)")
    c.add_argument("--keep", type=int, default=14, help="how many backups to keep (default: 14)")
    k = sub.add_parser("check", help="check a backup can be read")
    k.add_argument("backup")
    r = sub.add_parser("restore", help="put a backup back (stop the server first)")
    r.add_argument("backup")
    r.add_argument("--force", action="store_true", help="replace existing data (it is moved aside, not deleted)")
    args = parser.parse_args(argv)

    from app.config import get_settings

    s = get_settings()
    try:
        db, photos = sqlite_path(s.database_url), Path(s.photos_dir)
        if args.command == "create":
            target = create_backup(db, photos, Path(args.dest), keep=args.keep)
            info = check_backup(target)
            print(f"Backup saved: {target} ({info['database_bytes']} bytes database, {info['photos']} photos)")
        elif args.command == "check":
            info = check_backup(Path(args.backup))
            print(json.dumps(info, indent=2))
            return 0 if info["integrity_now"] == "ok" else 1
        else:
            moved = restore_backup(Path(args.backup), db, photos, force=args.force)
            for m in moved:
                print(f"Previous data kept at: {m}")
            print(f"Restored {args.backup}. Start the server and log in to check.")
    except BackupError as e:
        print(f"Backup: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
