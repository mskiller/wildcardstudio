"""F06 · Scanner TAG / Natural Language"""
import json
import os
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Any, Optional
from sqlmodel import Session, select
from datetime import datetime

from config import get_settings
from database import get_session
from models.wildcard import WildcardFile, WildcardEntry
from services.nl_detector import detect_style, approximate_nl_to_tag
from services.file_watcher import (
    acquire_scan_lock,
    index_file,
    is_wildcard_file,
    prune_missing_files,
    release_scan_lock,
    wildcard_rel_path,
)

router = APIRouter()
settings = get_settings()


class ConvertRequest(BaseModel):
    text: str
    direction: str = "nl_to_tag"  # 'nl_to_tag' | 'tag_to_nl'


@router.post("/scan")
def scan_all(session: Session = Depends(get_session)):
    """Re-scan and classify all wildcard files."""
    if not acquire_scan_lock(blocking=False):
        return {"scanned": 0, "pruned": 0, "status": "already_running"}
    updated = 0
    seen_paths: set[str] = set()
    try:
        for root, dirs, files in os.walk(settings.wildcards_path):
            dirs[:] = [d for d in dirs if d != ".git"]
            for fname in files:
                if not is_wildcard_file(fname):
                    continue
                full_path = os.path.join(root, fname)
                if os.path.exists(full_path):
                    seen_paths.add(wildcard_rel_path(full_path))
                    index_file(full_path, session)
                    updated += 1
        pruned = prune_missing_files(session, seen_paths)
        return {"scanned": updated, "pruned": pruned, "status": "completed"}
    finally:
        release_scan_lock()


@router.get("/results")
def get_results(session: Session = Depends(get_session)):
    files = session.exec(select(WildcardFile)).all()
    tag_count = sum(1 for f in files if f.prompt_style == "tag")
    nl_count = sum(1 for f in files if f.prompt_style == "nl")
    mixed_count = sum(1 for f in files if f.prompt_style == "mixed")
    unknown_count = sum(1 for f in files if f.prompt_style in (None, "unknown"))
    return {
        "summary": {
            "tag": tag_count,
            "nl": nl_count,
            "mixed": mixed_count,
            "unknown": unknown_count,
            "total": len(files),
        },
        "files": [
            {
                "path": f.path,
                "entry_count": f.entry_count,
                "prompt_style": f.prompt_style or "unknown",
                "format": f.format,
                "line_count": (f.blank_count or 0) + (f.comment_count or 0) + (f.entry_count or 0),
                "blank_count": f.blank_count,
                "comment_count": f.comment_count,
                "wildcard_refs_count": f.wildcard_refs_count,
                "variants_count": f.variants_count,
                "yaml_keys_count": f.yaml_keys_count,
                "classification": f.prompt_style or "unknown",
                "classification_score": f.classification_score,
                "classification_reasons": _load_reasons(f.classification_reasons),
                "last_scanned": f.last_scanned.isoformat() if f.last_scanned else None,
            }
            for f in files
        ],
    }


@router.get("/file")
def scan_file(path: str = Query(...), session: Session = Depends(get_session)):
    wf = session.exec(select(WildcardFile).where(WildcardFile.path == path)).first()
    if not wf:
        return {"error": "File not indexed"}
    entries = session.exec(
        select(WildcardEntry).where(WildcardEntry.file_id == wf.id)
    ).all()
    classified = []
    for e in entries:
        style, ts, nls = detect_style(e.content)
        classified.append({
            "content": e.content,
            "style": style,
            "tag_score": ts,
            "nl_score": nls,
            "line_number": e.line_number,
            "classification": e.prompt_style or style,
            "classification_score": e.classification_score,
            "classification_reasons": _load_reasons(e.classification_reasons),
            "refs": _load_json(e.ref_signature) or [],
            "syntax": _load_json(e.syntax_signature) or {},
        })
    return {
        "path": path,
        "overall_style": wf.prompt_style,
        "entries": classified,
    }


@router.post("/convert")
def convert_style(req: ConvertRequest):
    if req.direction == "nl_to_tag":
        result = approximate_nl_to_tag(req.text)
        note = "Conversion approximative (heuristique) — résultat à vérifier."
    else:
        # tag to NL: rough reconstruction
        tags = [t.strip() for t in req.text.split(",") if t.strip()]
        result = " ".join(tags) + "."
        note = "Conversion basique TAG → NL."
    return {"result": result, "note": note}


def _load_json(value: Optional[str]):
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _load_reasons(value: Optional[str]) -> list[str]:
    loaded = _load_json(value)
    return _reason_labels(loaded)


def _reason_labels(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, dict):
        labels: list[str] = []
        for key, raw in value.items():
            if raw is None or raw is False:
                continue
            if isinstance(raw, dict):
                for nested_key, nested_value in raw.items():
                    if nested_value not in (None, False, 0):
                        labels.append(f"{nested_key}: {nested_value}")
            else:
                labels.append(f"{key}: {raw}")
        return labels
    return [str(value)]
