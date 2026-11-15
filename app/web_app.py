"""Serve the real app's web build (`npx expo export -p web` in mobile/) from this server.

The build is a single-page app: index.html plus its scripts and images. Any page address such as
/sleep or /workouts gets index.html and the app shows the right screen. Addresses under /api are never
touched, so every API answer (including its 404s) stays exactly as before.

Without a build, "/" keeps showing the older simple web preview in app/static.
"""

from pathlib import Path

from fastapi import Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import PROJECT_DIR, get_settings

NO_CACHE = {"Cache-Control": "no-cache"}  # index.html must be re-checked so an update reaches testers


def web_dir() -> Path | None:
    """The web build folder, or None if it hasn't been built."""
    d = Path(get_settings().web_app_dir)
    if not d.is_absolute():
        d = PROJECT_DIR / d
    return d.resolve() if (d / "index.html").is_file() else None


def resolve(path: str) -> Path | None:
    """The file to send for a page address, or None (no build, or a missing file such as a .js)."""
    root = web_dir()
    if root is None:
        return None
    path = path.lstrip("/")
    if path:
        candidate = (root / path).resolve()
        if not candidate.is_relative_to(root):
            return None  # ../ tricks never leave the build folder
        if candidate.is_file():
            return candidate
        if "." in path.rsplit("/", 1)[-1]:
            return None  # a missing file, not a page: a real 404 instead of HTML in place of a script
    return root / "index.html"


def file_response(file: Path) -> FileResponse:
    return FileResponse(file, headers=NO_CACHE if file.name == "index.html" else None)


def is_page_request(request: Request) -> bool:
    path = request.url.path
    return request.method in ("GET", "HEAD") and path != "/api" and not path.startswith("/api/")


async def not_found_handler(request: Request, exc: StarletteHTTPException):
    """404 for a page address -> the web app; everything else -> FastAPI's normal answer."""
    if exc.status_code == 404 and is_page_request(request):
        file = resolve(request.url.path)
        if file is not None:
            return file_response(file)
    return await http_exception_handler(request, exc)
