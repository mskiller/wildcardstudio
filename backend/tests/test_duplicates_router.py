from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine, select

from database import get_session, run_additive_migrations
from models.scan import DuplicateGroup, DuplicateMember
from models.wildcard import WildcardEntry, WildcardFile
from routers import duplicates as duplicates_router


def build_client(tmp_path: Path):
    db_path = tmp_path / "duplicates.db"
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
    app.include_router(duplicates_router.router, prefix="/duplicates")
    return TestClient(app), engine


def seed_duplicate_groups(engine, count: int = 12) -> None:
    with Session(engine) as session:
        wf = WildcardFile(
            path="demo.txt",
            filename="demo.txt",
            format="impact",
            prompt_style="tag",
            entry_count=count * 2,
        )
        session.add(wf)
        session.flush()
        for index in range(count * 2):
            session.add(WildcardEntry(file_id=wf.id, line_number=index + 1, content=f"entry {index}"))
        session.commit()

        entries = session.exec(select(WildcardEntry)).all()
        for index in range(count):
            group = DuplicateGroup(status="pending" if index < 10 else "ignored")
            session.add(group)
            session.flush()
            left = entries[index * 2]
            right = entries[index * 2 + 1]
            session.add(DuplicateMember(group_id=group.id, entry_id=left.id, similarity=1.0))
            session.add(DuplicateMember(group_id=group.id, entry_id=right.id, similarity=1.0))
        session.commit()


def test_duplicate_groups_are_paginated(tmp_path: Path):
    client, engine = build_client(tmp_path)
    seed_duplicate_groups(engine)

    response = client.get("/duplicates/groups", params={"page": 2, "limit": 4})

    assert response.status_code == 200
    payload = response.json()
    assert payload["page"] == 2
    assert payload["limit"] == 4
    assert payload["total"] == 10
    assert payload["pending"] == 10
    assert payload["done"] == 2
    assert len(payload["items"]) == 4
    assert all(len(group["members"]) == 2 for group in payload["items"])
