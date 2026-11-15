import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlmodel import Session

from app.config import PROJECT_ENV, get_settings
from app.database import SessionDep, create_db_and_tables, engine
from app.routers import (
    analytics,
    assistant,
    auth,
    exercises,
    foods,
    gyms,
    marketing,
    me,
    measurements,
    points,
    sleep,
    snap,
    voice,
    whoop,
    workouts,
)
from app.routers.assistant import chosen_provider
from app.seed import seed_catalogue
from app import log_redaction, web_app
from app.startup_checks import current_commit, pilot_server_problems, pilot_server_warnings

STATIC_DIR = Path(__file__).parent / "static"
log = logging.getLogger("uvicorn.error")  # shows up in the server's console
log_redaction.install()  # WHOOP codes and unsubscribe links never reach the request log
APP_VERSION = "0.1.0"
COMMIT = current_commit()  # read once at start-up; shown by /api/health


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    problems = pilot_server_problems(s)
    if problems:  # checked before the database is touched
        for p in problems:
            log.error("Not starting the pilot server: %s", p)
        raise RuntimeError("Unsafe pilot server settings: " + "; ".join(problems))
    create_db_and_tables()
    with Session(engine) as session:
        seed_catalogue(session)
    for w in pilot_server_warnings(s):
        log.warning("Pilot server: %s", w)
    log.info("Sign-up: %s. Version %s, commit %s", "open" if s.allow_signup else "closed", APP_VERSION, COMMIT)
    if s.whoop_client_id and s.whoop_client_secret:
        log.info("WHOOP: on (redirect URL %s)", s.whoop_redirect_uri)
    else:
        log.warning("WHOOP: off. To turn it on, put WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in %s and restart", PROJECT_ENV)
    if chosen_provider() == "claude":
        log.info("Coach: Claude (%s)%s", s.assistant_model, "" if s.anthropic_api_key else ", but ANTHROPIC_API_KEY is missing")
    else:
        log.info("Coach: Ollama on this PC (%s at %s)", s.ollama_model, s.ollama_url)
    yield


app = FastAPI(title="Fitness App", version=APP_VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
for module in (auth, me, exercises, workouts, gyms, snap, voice, foods, measurements, sleep, whoop, analytics, points, assistant, marketing):
    api.include_router(module.router)


@api.get("/health", tags=["health"])
def health(session: SessionDep, response: Response):
    """For uptime checks and the release record. Public, so it shows versions only, never settings or users."""
    try:
        session.connection().execute(text("SELECT 1")).one()
        database = "ok"
    except Exception:  # any database failure means "down"
        database = "unavailable"
        response.status_code = 503
    return {
        "status": "ok" if database == "ok" else "degraded",
        "database": database,
        "version": APP_VERSION,
        "commit": COMMIT,
        "evidence_retrieval": "disabled",
    }


app.include_router(api)

# Web preview of the app (the React Native app in mobile/ uses the same API)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    """The real app's web build if it has been exported (see app/web_app.py), otherwise the simple preview."""
    page = web_app.resolve("")
    return web_app.file_response(page) if page else FileResponse(STATIC_DIR / "index.html")


@app.get("/preview", include_in_schema=False)
def simple_preview():
    return FileResponse(STATIC_DIR / "index.html")


app.add_exception_handler(StarletteHTTPException, web_app.not_found_handler)
