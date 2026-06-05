"""Metadata and review sidecars for wildcard files and entries."""
import hashlib
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models.metadata import WildcardEntryMetadata, WildcardFileMetadata
from models.wildcard import WildcardEntry, WildcardFile
from services.time_utils import utc_now

router = APIRouter()


class FileMetadataUpdate(BaseModel):
    path: str
    category: Optional[str] = None
    status: Optional[str] = None
    favorite: Optional[bool] = None
    notes: Optional[str] = None
    classification_override: Optional[str] = None


class EntryMetadataUpdate(BaseModel):
    entry_id: Optional[int] = None
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    category: Optional[str] = None
    status: Optional[str] = None
    favorite: Optional[bool] = None
    notes: Optional[str] = None
    classification_override: Optional[str] = None


def _normalize_path(path: str) -> str:
    normalized = path.replace("\\", "/").strip().lstrip("/")
    parts = [part for part in normalized.split("/") if part]
    if not parts:
        raise HTTPException(400, "path is required")
    if any(part == ".." for part in parts):
        raise HTTPException(400, "path traversal is not allowed")
    return "/".join(parts)


def _content_hash(content: Optional[str]) -> Optional[str]:
    if content is None:
        return None
    return hashlib.md5(content.encode("utf-8")).hexdigest()


def _apply_updates(target, body: BaseModel) -> None:
    for field in ("category", "status", "favorite", "notes", "classification_override"):
        if field in body.model_fields_set:
            setattr(target, field, getattr(body, field))
    target.updated_at = utc_now()


def _file_payload(path: str, metadata: Optional[WildcardFileMetadata], indexed: bool) -> dict:
    return {
        "scope": "file",
        "path": path,
        "category": metadata.category if metadata else None,
        "status": metadata.status if metadata else None,
        "favorite": metadata.favorite if metadata else False,
        "notes": metadata.notes if metadata else None,
        "classification_override": metadata.classification_override if metadata else None,
        "updated_at": metadata.updated_at.isoformat() if metadata and metadata.updated_at else None,
        "indexed": indexed,
    }


def _entry_payload(metadata: Optional[WildcardEntryMetadata], resolved: dict) -> dict:
    return {
        "scope": "entry",
        "entry_id": metadata.entry_id if metadata else resolved.get("entry_id"),
        "file_path": metadata.file_path if metadata else resolved.get("file_path"),
        "line_number": metadata.line_number if metadata else resolved.get("line_number"),
        "content_hash": metadata.content_hash if metadata else resolved.get("content_hash"),
        "category": metadata.category if metadata else None,
        "status": metadata.status if metadata else None,
        "favorite": metadata.favorite if metadata else False,
        "notes": metadata.notes if metadata else None,
        "classification_override": metadata.classification_override if metadata else None,
        "updated_at": metadata.updated_at.isoformat() if metadata and metadata.updated_at else None,
        "indexed": bool(resolved.get("entry_id")),
    }


def _resolve_entry(
    session: Session,
    entry_id: Optional[int],
    file_path: Optional[str],
    line_number: Optional[int],
) -> dict:
    entry = session.get(WildcardEntry, entry_id) if entry_id is not None else None
    wf = session.get(WildcardFile, entry.file_id) if entry and entry.file_id else None
    if entry and wf:
        return {
            "entry_id": entry.id,
            "file_path": wf.path,
            "line_number": entry.line_number,
            "content_hash": _content_hash(entry.content),
        }

    if file_path is None:
        raise HTTPException(400, "entry_id or file_path is required")

    normalized_path = _normalize_path(file_path)
    resolved = {
        "entry_id": entry_id,
        "file_path": normalized_path,
        "line_number": line_number,
        "content_hash": None,
    }
    if line_number is None:
        return resolved

    row = session.exec(
        select(WildcardEntry, WildcardFile)
        .join(WildcardFile, WildcardEntry.file_id == WildcardFile.id)
        .where(WildcardFile.path == normalized_path)
        .where(WildcardEntry.line_number == line_number)
    ).first()
    if row:
        found_entry, _found_file = row
        resolved.update({
            "entry_id": found_entry.id,
            "content_hash": _content_hash(found_entry.content),
        })
    return resolved


@router.get("/file")
def get_file_metadata(path: str = Query(...), session: Session = Depends(get_session)):
    normalized_path = _normalize_path(path)
    metadata = session.exec(
        select(WildcardFileMetadata).where(WildcardFileMetadata.file_path == normalized_path)
    ).first()
    indexed = session.exec(select(WildcardFile).where(WildcardFile.path == normalized_path)).first() is not None
    return _file_payload(normalized_path, metadata, indexed)


@router.put("/file")
def update_file_metadata(body: FileMetadataUpdate, session: Session = Depends(get_session)):
    normalized_path = _normalize_path(body.path)
    metadata = session.exec(
        select(WildcardFileMetadata).where(WildcardFileMetadata.file_path == normalized_path)
    ).first()
    if not metadata:
        metadata = WildcardFileMetadata(file_path=normalized_path)
        session.add(metadata)
    _apply_updates(metadata, body)
    session.commit()
    session.refresh(metadata)
    indexed = session.exec(select(WildcardFile).where(WildcardFile.path == normalized_path)).first() is not None
    return _file_payload(normalized_path, metadata, indexed)


@router.get("/entry")
def get_entry_metadata(
    entry_id: Optional[int] = Query(default=None),
    file_path: Optional[str] = Query(default=None),
    line_number: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
):
    resolved = _resolve_entry(session, entry_id, file_path, line_number)
    query = select(WildcardEntryMetadata).where(WildcardEntryMetadata.file_path == resolved["file_path"])
    if resolved.get("line_number") is not None:
        query = query.where(WildcardEntryMetadata.line_number == resolved["line_number"])
    elif resolved.get("entry_id") is not None:
        query = select(WildcardEntryMetadata).where(WildcardEntryMetadata.entry_id == resolved["entry_id"])
    metadata = session.exec(query).first()
    return _entry_payload(metadata, resolved)


@router.put("/entry")
def update_entry_metadata(body: EntryMetadataUpdate, session: Session = Depends(get_session)):
    resolved = _resolve_entry(session, body.entry_id, body.file_path, body.line_number)
    metadata = session.exec(
        select(WildcardEntryMetadata)
        .where(WildcardEntryMetadata.file_path == resolved["file_path"])
        .where(WildcardEntryMetadata.line_number == resolved.get("line_number"))
    ).first()
    if not metadata and resolved.get("entry_id") is not None:
        metadata = session.exec(
            select(WildcardEntryMetadata).where(WildcardEntryMetadata.entry_id == resolved["entry_id"])
        ).first()
    if not metadata:
        metadata = WildcardEntryMetadata(
            entry_id=resolved.get("entry_id"),
            file_path=resolved["file_path"],
            line_number=resolved.get("line_number"),
            content_hash=resolved.get("content_hash"),
        )
        session.add(metadata)
    metadata.entry_id = resolved.get("entry_id")
    metadata.file_path = resolved["file_path"]
    metadata.line_number = resolved.get("line_number")
    metadata.content_hash = resolved.get("content_hash")
    _apply_updates(metadata, body)
    session.commit()
    session.refresh(metadata)
    return _entry_payload(metadata, resolved)


@router.get("/options")
def list_metadata_options(session: Session = Depends(get_session)):
    def values(model, column_name: str) -> list[str]:
        column = getattr(model, column_name)
        rows = session.exec(select(column)).all()
        return sorted({value for value in rows if value})

    return {
        "file": {
            "categories": values(WildcardFileMetadata, "category"),
            "statuses": values(WildcardFileMetadata, "status"),
            "classification_overrides": values(WildcardFileMetadata, "classification_override"),
        },
        "entry": {
            "categories": values(WildcardEntryMetadata, "category"),
            "statuses": values(WildcardEntryMetadata, "status"),
            "classification_overrides": values(WildcardEntryMetadata, "classification_override"),
        },
        "suggested_statuses": ["new", "reviewing", "approved", "needs_fix", "archived"],
    }
