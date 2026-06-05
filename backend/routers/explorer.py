"""F01 · Explorateur de wildcards"""
import os
import json
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from config import get_settings
from database import get_session
from models.wildcard import WildcardFile, WildcardEntry
from services.yaml_parser import render_preview, parse_file
from services.file_watcher import index_file, register_ws_client, unregister_ws_client

router = APIRouter()
settings = get_settings()


def build_tree(base_path: str, rel_path: str = "") -> dict:
    """Recursively build file tree."""
    full = os.path.join(base_path, rel_path) if rel_path else base_path
    name = os.path.basename(full) or "wildcards"
    node = {"name": name, "path": rel_path or "/", "type": "directory", "children": []}
    try:
        entries = sorted(os.scandir(full), key=lambda e: (e.is_file(), e.name))
        for entry in entries:
            if entry.name.startswith("."):
                continue
            rel = os.path.join(rel_path, entry.name).replace("\\", "/") if rel_path else entry.name
            if entry.is_dir():
                node["children"].append(build_tree(base_path, rel))
            elif entry.name.endswith((".yaml", ".yml", ".txt")):
                node["children"].append({"name": entry.name, "path": rel, "type": "file"})
    except PermissionError:
        pass
    return node


@router.get("/tree")
def get_tree(session: Session = Depends(get_session)):
    tree = build_tree(settings.wildcards_path)
    # Enrich with DB metadata
    files = session.exec(select(WildcardFile)).all()
    meta = {f.path: {"format": f.format, "prompt_style": f.prompt_style, "entry_count": f.entry_count} for f in files}
    def enrich(node):
        if node["type"] == "file" and node["path"] in meta:
            node.update(meta[node["path"]])
        for child in node.get("children", []):
            enrich(child)
    enrich(tree)
    return tree


@router.get("/file")
def get_file(path: str = Query(...), session: Session = Depends(get_session)):
    full_path = os.path.join(settings.wildcards_path, path)
    if not os.path.exists(full_path):
        raise HTTPException(404, "File not found")
    content = open(full_path, encoding="utf-8", errors="replace").read()
    wf = session.exec(select(WildcardFile).where(WildcardFile.path == path)).first()
    return {
        "path": path,
        "content": content,
        "format": wf.format if wf else "impact",
        "prompt_style": wf.prompt_style if wf else "unknown",
        "entry_count": wf.entry_count if wf else 0,
    }


@router.put("/file")
def save_file(path: str = Query(...), body: dict = None, session: Session = Depends(get_session)):
    full_path = os.path.join(settings.wildcards_path, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    content = (body or {}).get("content", "")
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)
    wf = index_file(full_path, session)
    return {"ok": True, "path": path, "entry_count": wf.entry_count}


@router.delete("/file")
def delete_file(path: str = Query(...), session: Session = Depends(get_session)):
    full_path = os.path.join(settings.wildcards_path, path)
    if not os.path.exists(full_path):
        raise HTTPException(404, "File not found")
    os.remove(full_path)
    wf = session.exec(select(WildcardFile).where(WildcardFile.path == path)).first()
    if wf:
        for entry in session.exec(select(WildcardEntry).where(WildcardEntry.file_id == wf.id)).all():
            session.delete(entry)
        session.delete(wf)
        session.commit()
    return {"ok": True}


class CreateFileBody(BaseModel):
    path: str
    content: str = ""


@router.post("/file")
def create_file_route(body: CreateFileBody, session: Session = Depends(get_session)):
    full_path = os.path.join(settings.wildcards_path, body.path)
    if os.path.exists(full_path):
        raise HTTPException(409, "File already exists")
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(body.content)
    wf = index_file(full_path, session)
    return {"ok": True, "path": body.path}


@router.get("/preview")
def preview_file(path: str = Query(...), n: int = Query(5)):
    full_path = os.path.join(settings.wildcards_path, path)
    if not os.path.exists(full_path):
        raise HTTPException(404, "File not found")
    _, entries = parse_file(full_path)
    return {"samples": render_preview(entries, n)}


@router.get("/search")
def search_files(q: str = Query(...), session: Session = Depends(get_session)):
    results = []
    q_lower = q.lower()
    entries = session.exec(
        select(WildcardEntry, WildcardFile)
        .join(WildcardFile, WildcardEntry.file_id == WildcardFile.id)
    ).all()
    seen_files = {}
    for entry, wf in entries:
        if q_lower in entry.content.lower():
            if wf.path not in seen_files:
                seen_files[wf.path] = {"path": wf.path, "matches": []}
            seen_files[wf.path]["matches"].append({
                "content": entry.content,
                "line": entry.line_number,
            })
    return {"results": list(seen_files.values())[:50]}


@router.websocket("/watch")
async def watch_ws(websocket: WebSocket):
    await websocket.accept()
    register_ws_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        unregister_ws_client(websocket)
