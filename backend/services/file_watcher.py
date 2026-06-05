"""
File watcher: indexes /data/wildcards on startup and watches for changes.
Broadcasts WebSocket events to connected clients on file change.
"""
import asyncio
import os
import hashlib
import json
import logging
import re
import threading
from datetime import datetime
from typing import Any, Set
from sqlmodel import Session, delete, select
import yaml

from config import get_settings
from database import engine
from models.wildcard import WildcardFile, WildcardEntry
from services.time_utils import utc_from_timestamp, utc_now
from services.yaml_parser import parse_file
from services.nl_detector import classify_scores, detect_style

settings = get_settings()
logger = logging.getLogger("wildcardstudio.watcher")

_ws_clients: Set = set()
_scan_lock = threading.Lock()
WILDCARD_REF_RE = re.compile(r"__([A-Za-z0-9_./\\-]+)__")
VARIANT_RE = re.compile(r"\{([^{}]*\|[^{}]*)\}")
WEIGHTED_TAG_RE = re.compile(r"\([^)]+:\d+(?:\.\d+)?\)")
WEIGHTED_PREFIX_RE = re.compile(r"^::\d+(?:\.\d+)?::")


def register_ws_client(ws):
    _ws_clients.add(ws)


def unregister_ws_client(ws):
    _ws_clients.discard(ws)


def acquire_scan_lock(blocking: bool = True) -> bool:
    return _scan_lock.acquire(blocking=blocking)


def release_scan_lock() -> None:
    _scan_lock.release()


async def _broadcast(event: dict):
    dead = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    for ws in dead:
        _ws_clients.discard(ws)


def _checksum(path: str) -> str:
    try:
        digest = hashlib.md5()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        return ""


def _read_text(path: str) -> str:
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except Exception:
        return ""


def is_wildcard_file(filename: str) -> bool:
    return filename.endswith((".yaml", ".yml", ".txt"))


def wildcard_rel_path(path: str) -> str:
    return os.path.relpath(path, settings.wildcards_path).replace("\\", "/")


def _normalize(text: str) -> str:
    text = re.sub(r"\(([^)]+):\d+(?:\.\d+)?\)", r"\1", text)
    text = text.lower().strip()
    return re.sub(r"\s+", " ", text)


def _variant_count(text: str) -> int:
    total = 0
    for match in VARIANT_RE.findall(text):
        total += len([part for part in match.split("|") if part.strip()])
    return total


def _yaml_key_count(raw: str, path: str) -> int:
    if not path.endswith((".yaml", ".yml")):
        return 0
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError:
        return 0
    return _count_yaml_keys(data)


def _count_yaml_keys(value: Any) -> int:
    if isinstance(value, dict):
        return len(value) + sum(_count_yaml_keys(v) for v in value.values())
    if isinstance(value, list):
        return sum(_count_yaml_keys(item) for item in value)
    return 0


def _tag_signature(content: str) -> str:
    if "," in content:
        tokens = [token.strip().lower() for token in content.split(",")]
    else:
        tokens = re.split(r"\s+", content.strip().lower())
    cleaned = sorted({token for token in tokens if token})
    return json.dumps(cleaned, ensure_ascii=True)


def _ref_signature(content: str) -> str:
    refs = sorted({match.replace("\\", "/") for match in WILDCARD_REF_RE.findall(content)})
    return json.dumps(refs, ensure_ascii=True)


def _entry_metrics(content: str, style: str, tag_score: int, nl_score: int) -> dict:
    wildcard_refs_count = len(WILDCARD_REF_RE.findall(content))
    variants_count = _variant_count(content)
    syntax = {
        "comma_count": content.count(","),
        "weighted_tag_count": len(WEIGHTED_TAG_RE.findall(content)),
        "weighted_prefix": bool(WEIGHTED_PREFIX_RE.search(content.strip())),
        "wildcard_refs_count": wildcard_refs_count,
        "variant_block_count": len(VARIANT_RE.findall(content)),
        "variants_count": variants_count,
    }
    reasons = {
        "style": style,
        "tag_score": tag_score,
        "nl_score": nl_score,
    }
    return {
        "normalized_content": _normalize(content),
        "tag_signature": _tag_signature(content),
        "ref_signature": _ref_signature(content),
        "syntax_signature": json.dumps(syntax, ensure_ascii=True),
        "wildcard_refs_count": wildcard_refs_count,
        "variants_count": variants_count,
        "classification_score": float(max(tag_score, nl_score)),
        "classification_reasons": json.dumps(reasons, ensure_ascii=True),
    }


def _same_mtime(stored: datetime | None, current: datetime) -> bool:
    if stored is None:
        return False
    return abs((stored - current).total_seconds()) < 0.001


def _file_metrics(
    path: str,
    raw: str,
    scores: list[tuple[str, int, int]],
    style: str,
    entry_metrics: list[dict],
) -> dict:
    lines = raw.splitlines()
    blank_count = sum(1 for line in lines if not line.strip())
    comment_count = sum(1 for line in lines if line.strip().startswith("#"))
    style_counts = {"tag": 0, "nl": 0, "mixed": 0, "unknown": 0}
    for entry_style, _tag_score, _nl_score in scores:
        style_counts[entry_style] = style_counts.get(entry_style, 0) + 1
    average_score = (
        sum(max(tag_score, nl_score) for _entry_style, tag_score, nl_score in scores) / len(scores)
        if scores
        else 0.0
    )
    reasons = {
        "style": style,
        "style_counts": style_counts,
        "entries_scored": len(scores),
        "average_confidence": average_score,
    }
    return {
        "blank_count": blank_count,
        "comment_count": comment_count,
        "wildcard_refs_count": sum(metric["wildcard_refs_count"] for metric in entry_metrics),
        "variants_count": sum(metric["variants_count"] for metric in entry_metrics),
        "yaml_keys_count": _yaml_key_count(raw, path),
        "classification_score": float(average_score),
        "classification_reasons": json.dumps(reasons, ensure_ascii=True),
    }


def index_file(path: str, session: Session) -> WildcardFile:
    """Index or update a single wildcard file in the DB."""
    rel_path = wildcard_rel_path(path)
    filename  = os.path.basename(path)
    mtime     = utc_from_timestamp(os.path.getmtime(path))

    existing = session.exec(
        select(WildcardFile).where(WildcardFile.path == rel_path)
    ).first()

    if existing and existing.classification_reasons and _same_mtime(existing.last_modified, mtime):
        return existing

    checksum = _checksum(path)
    if existing and existing.checksum == checksum and existing.classification_reasons:
        existing.last_modified = mtime
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    raw = _read_text(path)
    fmt, entries = parse_file(path)
    scores = [detect_style(content) for _line_no, content, _weight in entries]
    style = classify_scores(scores)
    entry_metrics = [
        _entry_metrics(content, entry_style, tag_score, nl_score)
        for (_line_no, content, _weight), (entry_style, tag_score, nl_score) in zip(entries, scores)
    ]
    file_metrics = _file_metrics(path, raw, scores, style, entry_metrics)

    if existing:
        if existing.checksum == checksum and existing.classification_reasons:
            return existing
        existing.filename    = filename
        existing.format      = fmt
        existing.prompt_style = style
        existing.entry_count = len(entries)
        existing.blank_count = file_metrics["blank_count"]
        existing.comment_count = file_metrics["comment_count"]
        existing.wildcard_refs_count = file_metrics["wildcard_refs_count"]
        existing.variants_count = file_metrics["variants_count"]
        existing.yaml_keys_count = file_metrics["yaml_keys_count"]
        existing.classification_score = file_metrics["classification_score"]
        existing.classification_reasons = file_metrics["classification_reasons"]
        existing.last_scanned = utc_now()
        existing.last_modified = mtime
        existing.checksum    = checksum
        # delete old entries
        for old in session.exec(
            select(WildcardEntry).where(WildcardEntry.file_id == existing.id)
        ).all():
            session.delete(old)
        wf = existing
    else:
        wf = WildcardFile(
            path=rel_path, filename=filename, format=fmt,
            prompt_style=style, entry_count=len(entries),
            blank_count=file_metrics["blank_count"],
            comment_count=file_metrics["comment_count"],
            wildcard_refs_count=file_metrics["wildcard_refs_count"],
            variants_count=file_metrics["variants_count"],
            yaml_keys_count=file_metrics["yaml_keys_count"],
            classification_score=file_metrics["classification_score"],
            classification_reasons=file_metrics["classification_reasons"],
            last_scanned=utc_now(), last_modified=mtime,
            checksum=checksum,
        )
        session.add(wf)
        session.flush()

    for (line_no, content, weight), (e_style, _tag_score, _nl_score), metrics in zip(entries, scores, entry_metrics):
        session.add(WildcardEntry(
            file_id=wf.id, line_number=line_no,
            content=content, weight=weight, prompt_style=e_style,
            normalized_content=metrics["normalized_content"],
            tag_signature=metrics["tag_signature"],
            ref_signature=metrics["ref_signature"],
            syntax_signature=metrics["syntax_signature"],
            wildcard_refs_count=metrics["wildcard_refs_count"],
            variants_count=metrics["variants_count"],
            classification_score=metrics["classification_score"],
            classification_reasons=metrics["classification_reasons"],
        ))

    session.commit()
    session.refresh(wf)
    return wf


def prune_missing_files(session: Session, existing_paths: set[str]) -> int:
    """Remove indexed files and entries that are no longer present on disk."""
    indexed_files = session.exec(select(WildcardFile)).all()
    stale_ids = [
        file.id
        for file in indexed_files
        if file.id is not None and file.path not in existing_paths
    ]
    if not stale_ids:
        return 0
    session.exec(delete(WildcardEntry).where(WildcardEntry.file_id.in_(stale_ids)))
    session.exec(delete(WildcardFile).where(WildcardFile.id.in_(stale_ids)))
    session.commit()
    return len(stale_ids)


def scan_all():
    """Full synchronous re-index of the wildcards directory."""
    if not os.path.exists(settings.wildcards_path):
        logger.warning("Wildcards path not found: %s", settings.wildcards_path)
        return
    if not acquire_scan_lock(blocking=False):
        logger.info("Initial indexing skipped — scan already running.")
        return
    count = 0
    seen_paths: set[str] = set()
    try:
        with Session(engine) as session:
            for root, dirs, files in os.walk(settings.wildcards_path):
                dirs[:] = [d for d in dirs if d != ".git"]
                for fname in files:
                    if is_wildcard_file(fname):
                        full_path = os.path.join(root, fname)
                        seen_paths.add(wildcard_rel_path(full_path))
                        try:
                            index_file(full_path, session)
                            count += 1
                        except Exception as exc:
                            logger.error("Error indexing %s: %s", fname, exc)
            pruned = prune_missing_files(session, seen_paths)
        logger.info("Initial indexing complete — %d files, %d stale removed.", count, pruned)
    finally:
        release_scan_lock()


async def _watch_loop():
    """Async loop that watches for file-system changes and re-indexes."""
    if not os.path.exists(settings.wildcards_path):
        return
    try:
        from watchfiles import awatch
        async for changes in awatch(settings.wildcards_path):
            for _change_type, path in changes:
                if not is_wildcard_file(path):
                    continue
                logger.info("File changed: %s", path)
                if not acquire_scan_lock(blocking=False):
                    logger.info("Watcher re-index skipped while full scan is running: %s", path)
                    continue
                with Session(engine) as session:
                    try:
                        wf = index_file(path, session)
                        await _broadcast({"event": "file_changed", "path": wf.path})
                    except Exception as exc:
                        logger.error("Watcher re-index error: %s", exc)
                    finally:
                        release_scan_lock()
    except Exception as exc:
        logger.error("Watcher loop crashed: %s", exc)
