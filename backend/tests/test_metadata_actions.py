from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine, select

from database import get_session, run_additive_migrations
from models.wildcard import WildcardEntry, WildcardFile
from routers import actions as actions_router
from routers import metadata as metadata_router


def build_client(tmp_path: Path):
    db_path = tmp_path / "metadata-actions.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    run_additive_migrations(engine)

    def override_session():
        with Session(engine) as session:
            yield session

    app = FastAPI()
    app.dependency_overrides[get_session] = override_session
    app.include_router(metadata_router.router, prefix="/metadata")
    app.include_router(actions_router.router, prefix="/actions")
    return TestClient(app), engine


def seed_entries(engine):
    with Session(engine) as session:
        wf = WildcardFile(
            path="characters/demo.txt",
            filename="demo.txt",
            format="impact",
            prompt_style="tag",
            entry_count=3,
        )
        session.add(wf)
        session.flush()
        session.add(WildcardEntry(file_id=wf.id, line_number=1, content="masterpiece, 1girl"))
        session.add(WildcardEntry(file_id=wf.id, line_number=2, content="masterpiece, 1girl"))
        session.add(WildcardEntry(file_id=wf.id, line_number=3, content="golden hour"))
        session.commit()


def test_file_and_entry_metadata_save_get(tmp_path: Path):
    client, engine = build_client(tmp_path)
    seed_entries(engine)

    file_resp = client.put(
        "/metadata/file",
        json={
            "path": "characters/demo.txt",
            "category": "characters",
            "status": "reviewing",
            "favorite": True,
            "notes": "Needs curation",
            "classification_override": "tag",
        },
    )
    assert file_resp.status_code == 200
    assert file_resp.json()["favorite"] is True

    get_file_resp = client.get("/metadata/file", params={"path": "characters/demo.txt"})
    assert get_file_resp.status_code == 200
    payload = get_file_resp.json()
    assert payload["category"] == "characters"
    assert payload["status"] == "reviewing"
    assert payload["indexed"] is True

    with Session(engine) as session:
        entry = session.exec(select(WildcardEntry).where(WildcardEntry.line_number == 1)).first()

    entry_resp = client.put(
        "/metadata/entry",
        json={
            "entry_id": entry.id,
            "status": "approved",
            "favorite": True,
            "notes": "Keep this one",
        },
    )
    assert entry_resp.status_code == 200
    assert entry_resp.json()["line_number"] == 1

    get_entry_resp = client.get(
        "/metadata/entry",
        params={"file_path": "characters/demo.txt", "line_number": 1},
    )
    assert get_entry_resp.status_code == 200
    entry_payload = get_entry_resp.json()
    assert entry_payload["status"] == "approved"
    assert entry_payload["content_hash"]


def test_additive_migration_columns_are_created(tmp_path: Path):
    db_path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE wildcard_file (id INTEGER PRIMARY KEY, path VARCHAR)")
        connection.exec_driver_sql("CREATE TABLE wildcard_entry (id INTEGER PRIMARY KEY, content VARCHAR)")

    run_additive_migrations(engine)

    with engine.begin() as connection:
        file_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(wildcard_file)").fetchall()
        }
        entry_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(wildcard_entry)").fetchall()
        }
    assert {"blank_count", "comment_count", "classification_reasons"}.issubset(file_columns)
    assert {"normalized_content", "tag_signature", "syntax_signature"}.issubset(entry_columns)


def test_action_preview_direct_scan_shape(tmp_path: Path):
    client, engine = build_client(tmp_path)
    seed_entries(engine)

    resp = client.post("/actions/preview", json={"source": "scan", "threshold": 85})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["action"] == "dedupe_cleanup"
    assert payload["source"] == "direct_duplicate_scan"
    assert payload["summary"]["groups"] == 1
    assert payload["summary"]["proposed_removals"] == 1
    assert payload["groups"][0]["canonical"]
    assert {action["type"] for action in payload["groups"][0]["proposed_actions"]} == {
        "keep",
        "remove_duplicate",
    }

    with Session(engine) as session:
        assert len(session.exec(select(WildcardEntry)).all()) == 3
