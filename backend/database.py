from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from config import get_settings
import os

settings = get_settings()

# Ensure DB directory exists
os.makedirs(os.path.dirname(settings.db_path), exist_ok=True)

DATABASE_URL = f"sqlite:///{settings.db_path}"
ASYNC_DATABASE_URL = f"sqlite+aiosqlite:///{settings.db_path}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 30},
)
async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, connect_args={"timeout": 30})

AsyncSessionLocal = sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def create_db_and_tables():
    _import_models()
    SQLModel.metadata.create_all(engine)
    run_additive_migrations(engine)


def _import_models():
    """Register SQLModel tables before create_all is called."""
    import models.metadata  # noqa: F401
    import models.prompt  # noqa: F401
    import models.scan  # noqa: F401
    import models.tag  # noqa: F401
    import models.wildcard  # noqa: F401


MIGRATION_COLUMNS = {
    "wildcard_file": {
        "blank_count": "INTEGER NOT NULL DEFAULT 0",
        "comment_count": "INTEGER NOT NULL DEFAULT 0",
        "wildcard_refs_count": "INTEGER NOT NULL DEFAULT 0",
        "variants_count": "INTEGER NOT NULL DEFAULT 0",
        "yaml_keys_count": "INTEGER NOT NULL DEFAULT 0",
        "classification_score": "REAL",
        "classification_reasons": "TEXT",
    },
    "wildcard_entry": {
        "normalized_content": "TEXT",
        "tag_signature": "TEXT",
        "ref_signature": "TEXT",
        "syntax_signature": "TEXT",
        "wildcard_refs_count": "INTEGER NOT NULL DEFAULT 0",
        "variants_count": "INTEGER NOT NULL DEFAULT 0",
        "classification_score": "REAL",
        "classification_reasons": "TEXT",
    },
    "wildcard_file_metadata": {
        "category": "VARCHAR",
        "status": "VARCHAR",
        "favorite": "INTEGER NOT NULL DEFAULT 0",
        "notes": "TEXT",
        "classification_override": "VARCHAR",
        "updated_at": "DATETIME",
    },
    "wildcard_entry_metadata": {
        "entry_id": "INTEGER",
        "content_hash": "VARCHAR",
        "category": "VARCHAR",
        "status": "VARCHAR",
        "favorite": "INTEGER NOT NULL DEFAULT 0",
        "notes": "TEXT",
        "classification_override": "VARCHAR",
        "updated_at": "DATETIME",
    },
}

MIGRATION_INDEXES = {
    "wildcard_entry": {
        "ix_wildcard_entry_file_id": (
            "CREATE INDEX IF NOT EXISTS ix_wildcard_entry_file_id ON wildcard_entry (file_id)",
            {"file_id"},
        ),
    },
}


def run_additive_migrations(target_engine=engine):
    """Add columns missing from existing SQLite databases.

    SQLModel.create_all creates new tables, but it intentionally does not alter
    existing ones. This keeps old local databases compatible after index fields
    are added.
    """
    with target_engine.begin() as connection:
        for table_name, columns in MIGRATION_COLUMNS.items():
            existing = _table_columns(connection, table_name)
            if not existing:
                continue
            for column_name, definition in columns.items():
                if column_name not in existing:
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
                    )
        for table_name, indexes in MIGRATION_INDEXES.items():
            existing = _table_columns(connection, table_name)
            if not existing:
                continue
            for definition, required_columns in indexes.values():
                if not required_columns.issubset(existing):
                    continue
                connection.exec_driver_sql(definition)


def _table_columns(connection, table_name: str) -> set[str]:
    rows = connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def get_session():
    with Session(engine) as session:
        yield session


async def get_async_session():
    async with AsyncSessionLocal() as session:
        yield session
