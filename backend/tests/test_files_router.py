from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import files as files_router
from services import file_ops


def build_client(tmp_path: Path) -> TestClient:
    wildcards_dir = tmp_path / "wildcards"
    backups_dir = tmp_path / "backups"
    wildcards_dir.mkdir(parents=True, exist_ok=True)
    backups_dir.mkdir(parents=True, exist_ok=True)

    file_ops.settings.wildcards_path = str(wildcards_dir)
    file_ops.settings.backups_path = str(backups_dir)

    app = FastAPI()
    app.include_router(files_router.router, prefix="/files")
    return TestClient(app)


def test_get_put_export_happy_path(tmp_path: Path):
    client = build_client(tmp_path)
    target = tmp_path / "wildcards" / "sub" / "demo.yaml"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("line1\nline2\n", encoding="utf-8")

    get_resp = client.get("/files/content", params={"file": "sub/demo.yaml"})
    assert get_resp.status_code == 200
    payload = get_resp.json()
    assert payload["path"] == "sub/demo.yaml"
    assert payload["name"] == "demo.yaml"
    assert payload["extension"] == ".yaml"
    assert payload["line_count"] == 3
    assert payload["writable"] is True

    put_resp = client.put(
        "/files/content",
        json={"file": "sub/demo.yaml", "content": "updated\nvalue", "backup": True},
    )
    assert put_resp.status_code == 200
    put_payload = put_resp.json()
    assert put_payload["content"] == "updated\nvalue"
    assert put_payload["line_count"] == 2
    assert target.read_text(encoding="utf-8") == "updated\nvalue"

    backup_dir = tmp_path / "backups" / "editor"
    backups = list(backup_dir.glob("demo.*.yaml"))
    assert len(backups) == 1

    export_resp = client.get("/files/export", params={"file": "sub/demo.yaml"})
    assert export_resp.status_code == 200
    assert export_resp.headers["content-disposition"].startswith("attachment;")


def test_reject_traversal_path(tmp_path: Path):
    client = build_client(tmp_path)
    resp = client.get("/files/content", params={"file": "../secret.yaml"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "path traversal is not allowed"


def test_reject_invalid_extension(tmp_path: Path):
    client = build_client(tmp_path)
    resp = client.get("/files/content", params={"file": "notes.md"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid file extension"
