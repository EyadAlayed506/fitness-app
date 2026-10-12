import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from app.config import PROJECT_ENV, get_settings
from app.database import create_db_and_tables, engine
from app.routers import (
    analytics,
    assistant,
    auth,
    exercises,
    foods,
    marketing,
    me,
    measurements,
    points,
    sleep,
    whoop,
    workouts,
)
from app.routers.assistant import chosen_provider
from app.seed import seed_catalogue

STATIC_DIR = Path(__file__).parent / "static"
log = logging.getLogger("uvicorn.error")  # shows up in the server's console


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    with Session(engine) as session:
        seed_catalogue(session)
    s = get_settings()
    if s.whoop_client_id and s.whoop_client_secret:
        log.info("WHOOP: on (redirect URL %s)", s.whoop_redirect_uri)
    else:
        log.warning("WHOOP: off. To turn it on, put WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in %s and restart", PROJECT_ENV)
    if chosen_provider() == "claude":
        log.info("Coach: Claude (%s)%s", s.assistant_model, "" if s.anthropic_api_key else ", but ANTHROPIC_API_KEY is missing")
    else:
        log.info("Coach: Ollama on this PC (%s at %s)", s.ollama_model, s.ollama_url)
    yield


app = FastAPI(title="Fitness App", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
for module in (auth, me, exercises, workouts, foods, measurements, sleep, whoop, analytics, points, assistant, marketing):
    api.include_router(module.router)
app.include_router(api)

# Web preview of the app (the React Native app in mobile/ uses the same API)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")
