import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from database import get_session
from models.tag import Tag, TagCategory
from models.wildcard import WildcardEntry, WildcardFile
from routers import library as library_router
from routers import scanner as scanner_router
from routers import tags as tags_router
from services import file_watcher


def build_client(tmp_path: Path) -> tuple[TestClient, object]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    def override_session():
        with Session(engine) as session:
            yield session

    app = FastAPI()
    app.dependency_overrides[get_session] = override_session
    app.include_router(scanner_router.router, prefix="/scanner")
    app.include_router(library_router.router, prefix="/library")
    app.include_router(tags_router.router, prefix="/tags")
    return TestClient(app), engine


def seed_wildcards(engine):
    with Session(engine) as session:
        session.add(TagCategory(name="subject", icon="person", position=1))
        session.add(TagCategory(name="quality", icon="star", position=2))
        session.add(TagCategory(name="character", icon="person", position=3))
        session.flush()
        wf = WildcardFile(
            path="comfyui/demo.txt",
            filename="demo.txt",
            format="impact",
            prompt_style="tag",
            entry_count=2,
            classification_score=87.0,
            classification_reasons=json.dumps({
                "style": "tag",
                "style_counts": {"tag": 2, "unknown": 0},
                "average_confidence": 87.0,
            }),
        )
        session.add(wf)
        session.flush()
        session.add(WildcardEntry(
            file_id=wf.id,
            line_number=1,
            content="masterpiece, best quality, 1girl",
            prompt_style="tag",
            tag_signature=json.dumps(["(masterpiece:1.2)", "best quality", "1girl"]),
            classification_score=90.0,
            classification_reasons=json.dumps({"style": "tag", "tag_score": 90}),
        ))
        session.add(WildcardEntry(
            file_id=wf.id,
            line_number=2,
            content="cinematic lighting, portrait",
            prompt_style="tag",
            tag_signature=json.dumps(["cinematic lighting", "portrait"]),
        ))
        session.commit()


def seed_character_wildcards(engine):
    with Session(engine) as session:
        wf = WildcardFile(
            path="comfyui/mskiller/mklan-female-Card.txt",
            filename="mklan-female-Card.txt",
            format="impact",
            prompt_style="unknown",
            entry_count=3,
        )
        session.add(wf)
        session.flush()
        session.add(WildcardEntry(
            file_id=wf.id,
            line_number=1,
            content="Mulan (Disney), MulanXLP",
            prompt_style="unknown",
            tag_signature=json.dumps(["mulan", "disney", "mulanxlp"]),
        ))
        session.add(WildcardEntry(
            file_id=wf.id,
            line_number=2,
            content="{wise|belle|yixuan} (zenless zone zero)",
            prompt_style="unknown",
            tag_signature=json.dumps(["wise", "belle", "yixuan", "zenless", "zone", "zero"]),
        ))
        session.add(WildcardEntry(
            file_id=wf.id,
            line_number=3,
            content="maid marian (disney), anthro fox, fur",
            prompt_style="tag",
            tag_signature=json.dumps(["maid marian (disney)", "anthro fox", "fur"]),
        ))
        session.commit()


def test_scanner_reasons_are_client_safe_arrays(tmp_path: Path):
    client, engine = build_client(tmp_path)
    seed_wildcards(engine)

    resp = client.get("/scanner/results")
    assert resp.status_code == 200
    first_file = resp.json()["files"][0]
    assert isinstance(first_file["classification_reasons"], list)
    assert "style: tag" in first_file["classification_reasons"]

    detail_resp = client.get("/scanner/file", params={"path": "comfyui/demo.txt"})
    assert detail_resp.status_code == 200
    first_entry = detail_resp.json()["entries"][0]
    assert isinstance(first_entry["classification_reasons"], list)
    assert "tag_score: 90" in first_entry["classification_reasons"]


def test_library_falls_back_to_indexed_wildcard_entries(tmp_path: Path):
    client, engine = build_client(tmp_path)
    seed_wildcards(engine)

    resp = client.get("/library/", params={"page": 1, "limit": 10})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total"] == 2
    assert payload["items"][0]["id"] < 0
    assert payload["items"][0]["content"]
    assert payload["items"][0]["collection"] == "comfyui"

    collections_resp = client.get("/library/collections")
    assert collections_resp.status_code == 200
    assert collections_resp.json()["collections"] == ["comfyui"]


def test_tags_derive_and_import_from_wildcards(tmp_path: Path):
    client, engine = build_client(tmp_path)
    seed_wildcards(engine)

    derived_resp = client.get("/tags/")
    assert derived_resp.status_code == 200
    derived = derived_resp.json()
    assert {item["name"] for item in derived} >= {"masterpiece", "best quality", "1girl"}
    assert "(masterpiece" not in {item["name"] for item in derived}
    assert all(item["id"] < 0 for item in derived)

    import_resp = client.post("/tags/import-from-wildcards")
    assert import_resp.status_code == 200
    assert import_resp.json()["imported"] >= 3

    persisted_resp = client.get("/tags/")
    assert persisted_resp.status_code == 200
    persisted = persisted_resp.json()
    assert {item["name"] for item in persisted} >= {"masterpiece", "best quality", "1girl"}
    assert all(item["id"] > 0 for item in persisted)


def test_tags_derive_character_category_from_character_lists(tmp_path: Path):
    client, engine = build_client(tmp_path)
    seed_wildcards(engine)
    seed_character_wildcards(engine)

    categories = client.get("/tags/categories").json()
    character_id = next(cat["id"] for cat in categories if cat["name"] == "character")
    subject_id = next(cat["id"] for cat in categories if cat["name"] == "subject")
    with Session(engine) as session:
        session.add(Tag(name="persisted subject", category_id=subject_id, aliases="[]"))
        session.commit()

    resp = client.get("/tags/", params={"category": character_id})
    assert resp.status_code == 200
    derived = resp.json()
    names = {item["name"] for item in derived}

    assert names >= {
        "mulan disney",
        "wise zenless zone zero",
        "belle zenless zone zero",
        "yixuan zenless zone zero",
        "maid marian disney",
    }
    assert "mulanxlp" not in names
    assert all(item["category_id"] == character_id for item in derived)


def test_index_file_skips_unchanged_files_before_parsing(tmp_path: Path, monkeypatch):
    _client, engine = build_client(tmp_path)
    wildcards_dir = tmp_path / "wildcards"
    wildcards_dir.mkdir()
    target = wildcards_dir / "demo.txt"
    target.write_text("masterpiece, best quality, 1girl\n", encoding="utf-8")

    previous_path = file_watcher.settings.wildcards_path
    file_watcher.settings.wildcards_path = str(wildcards_dir)
    try:
        with Session(engine) as session:
            indexed = file_watcher.index_file(str(target), session)
            assert indexed.entry_count == 1

        def fail_parse(_path: str):
            raise AssertionError("unchanged files should return before parsing")

        monkeypatch.setattr(file_watcher, "parse_file", fail_parse)
        with Session(engine) as session:
            indexed = file_watcher.index_file(str(target), session)
            assert indexed.entry_count == 1
    finally:
        file_watcher.settings.wildcards_path = previous_path


def test_prune_missing_files_removes_stale_index_rows(tmp_path: Path):
    _client, engine = build_client(tmp_path)
    wildcards_dir = tmp_path / "wildcards"
    wildcards_dir.mkdir()
    keep = wildcards_dir / "keep.txt"
    stale = wildcards_dir / "stale.txt"
    keep.write_text("masterpiece, best quality\n", encoding="utf-8")
    stale.write_text("old, removed\n", encoding="utf-8")

    previous_path = file_watcher.settings.wildcards_path
    file_watcher.settings.wildcards_path = str(wildcards_dir)
    try:
        with Session(engine) as session:
            file_watcher.index_file(str(keep), session)
            file_watcher.index_file(str(stale), session)
            pruned = file_watcher.prune_missing_files(session, {"keep.txt"})
            assert pruned == 1
            files = session.exec(select(WildcardFile)).all()
            entries = session.exec(select(WildcardEntry)).all()
            assert [file.path for file in files] == ["keep.txt"]
            assert len(entries) == 1
    finally:
        file_watcher.settings.wildcards_path = previous_path
