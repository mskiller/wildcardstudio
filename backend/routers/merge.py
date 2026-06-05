"""F09 · Fusion & nettoyage de wildcards"""
import os
import json
import shutil
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sqlmodel import Session, select

from config import get_settings
from database import get_session
from models.prompt import MergeHistory
from services.yaml_parser import parse_file
from services.fuzzy_matcher import find_duplicates
from services.diff_engine import compute_diff
from services.file_watcher import index_file
from services.time_utils import utc_now
import yaml

router = APIRouter()
settings = get_settings()

# In-memory prepare tokens
_prepare_cache = {}


class PrepareRequest(BaseModel):
    sources: List[str]       # relative paths
    target: str              # relative target path


class ExecuteRequest(BaseModel):
    prepare_token: str
    delete_sources: bool = False
    confirm: bool = True


@router.post("/prepare")
def prepare_merge(req: PrepareRequest, session: Session = Depends(get_session)):
    """Prepare a merge: compute diffs and deduplicated preview."""
    all_entries = []
    source_contents = {}

    for path in req.sources:
        full = os.path.join(settings.wildcards_path, path)
        if not os.path.exists(full):
            raise HTTPException(404, f"Source file not found: {path}")
        fmt, entries = parse_file(full)
        source_contents[path] = [e[1] for e in entries]
        for line, content, weight in entries:
            all_entries.append({"id": len(all_entries), "file": path, "content": content})

    # Find duplicates between sources
    dupes = find_duplicates(all_entries, threshold=85)

    # Build deduplicated merged list (keep first occurrence)
    seen = set()
    merged = []
    for entry in all_entries:
        norm = entry["content"].lower().strip()
        if norm not in seen:
            seen.add(norm)
            merged.append(entry["content"])

    # Build diff summary between first two sources (if 2+)
    diff_summary = None
    if len(req.sources) >= 2:
        left = ", ".join(source_contents[req.sources[0]])
        right = ", ".join(source_contents[req.sources[1]])
        diff_summary = compute_diff(left, right)

    token = str(uuid.uuid4())[:8]
    _prepare_cache[token] = {
        "sources": req.sources,
        "target": req.target,
        "merged": merged,
    }

    return {
        "prepare_token": token,
        "source_entry_counts": {p: len(c) for p, c in source_contents.items()},
        "merged_entry_count": len(merged),
        "duplicate_groups": len(dupes),
        "diff_summary": diff_summary,
        "preview": "\n".join(merged),
    }


@router.post("/execute")
def execute_merge(req: ExecuteRequest, session: Session = Depends(get_session)):
    """Execute the merge."""
    if req.prepare_token not in _prepare_cache:
        raise HTTPException(400, "Invalid or expired prepare token")

    data = _prepare_cache.pop(req.prepare_token)
    sources = data["sources"]
    target = data["target"]
    merged = data["merged"]

    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    backup_dir = os.path.join(settings.backups_path, f"merge-{timestamp}")
    os.makedirs(backup_dir, exist_ok=True)

    # Backup sources
    for path in sources:
        full = os.path.join(settings.wildcards_path, path)
        if os.path.exists(full):
            shutil.copy2(full, os.path.join(backup_dir, os.path.basename(path)))

    # Write merged file
    target_full = os.path.join(settings.wildcards_path, target)
    os.makedirs(os.path.dirname(target_full), exist_ok=True)
    with open(target_full, "w", encoding="utf-8") as f:
        yaml.dump(merged, f, allow_unicode=True, default_flow_style=False)

    # Delete sources if requested
    if req.delete_sources:
        for path in sources:
            full = os.path.join(settings.wildcards_path, path)
            if os.path.exists(full):
                os.remove(full)

    # Index new file
    index_file(target_full, session)

    # Save history
    history = MergeHistory(
        source_files=json.dumps(sources),
        result_file=target,
        backup_path=backup_dir,
        summary=f"Merged {len(sources)} files into {target}. {len(merged)} entries.",
    )
    session.add(history)
    session.commit()
    session.refresh(history)

    return {"ok": True, "history_id": history.id, "merged_entries": len(merged)}


@router.get("/history")
def get_history(session: Session = Depends(get_session)):
    history = session.exec(select(MergeHistory)).all()
    return [
        {
            "id": h.id,
            "merged_at": h.merged_at.isoformat(),
            "source_files": json.loads(h.source_files),
            "result_file": h.result_file,
            "summary": h.summary,
            "status": h.status,
        }
        for h in history
    ]


@router.post("/rollback/{history_id}")
def rollback_merge(history_id: int, session: Session = Depends(get_session)):
    """Restore sources from backup and remove merged file."""
    h = session.get(MergeHistory, history_id)
    if not h:
        raise HTTPException(404, "History entry not found")
    if h.status == "rolled_back":
        raise HTTPException(400, "Already rolled back")

    backup_dir = h.backup_path
    sources = json.loads(h.source_files)

    # Restore sources
    if backup_dir and os.path.exists(backup_dir):
        for path in sources:
            backup_file = os.path.join(backup_dir, os.path.basename(path))
            if os.path.exists(backup_file):
                dest = os.path.join(settings.wildcards_path, path)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(backup_file, dest)

    # Remove merged file
    target_full = os.path.join(settings.wildcards_path, h.result_file)
    if os.path.exists(target_full):
        os.remove(target_full)

    h.status = "rolled_back"
    session.commit()
    return {"ok": True}
