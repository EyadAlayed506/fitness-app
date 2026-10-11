from typing import Annotated

from fastapi import Depends
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)


def create_db_and_tables() -> None:
    # Import models so their tables are registered on SQLModel.metadata
    from app import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    add_missing_columns(engine)


def add_missing_columns(engine: Engine) -> list[str]:
    """Add new nullable columns to tables that already exist, so an older database keeps working.

    A small stand-in until Alembic migrations (build phase 5): it only ever adds columns.
    """
    from app import models  # noqa: F401

    inspector = inspect(engine)
    added = []
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing or not column.nullable:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))
                added.append(f"{table.name}.{column.name}")
    return added


def get_session():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
