from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from app.database import create_db_and_tables, engine
from app.routers import (
    analytics,
    auth,
    exercises,
    foods,
    marketing,
    me,
    measurements,
    workouts,
)
from app.seed import seed_catalogue

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    with Session(engine) as session:
        seed_catalogue(session)
    yield


app = FastAPI(title="Fitness App", version="0.1.0", lifespan=lifespan)

api = APIRouter(prefix="/api")
for module in (auth, me, exercises, workouts, foods, measurements, analytics, marketing):
    api.include_router(module.router)
app.include_router(api)

# Web preview of the app (the real client will be a mobile app using the same API)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")
