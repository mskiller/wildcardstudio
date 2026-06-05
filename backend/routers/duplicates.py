"""F05 · Détecteur de doublons"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy import func
from sqlmodel import Session, select

from database import get_session
from models.wildcard import WildcardEntry, WildcardFile
from models.scan import DuplicateGroup, DuplicateMember
from services.fuzzy_matcher import find_duplicates

router = APIRouter()
logger = logging.getLogger("wildcardstudio.duplicates")


class ScanRequest(BaseModel):
    threshold: int = 85
    scope: Optional[str] = None  # None = all, or folder path


class BatchAction(BaseModel):
    group_ids: List[int]
    action: str  # 'ignore' | 'merge'


@router.post("/scan")
def scan_duplicates(req: ScanRequest, session: Session = Depends(get_session)):
    """Run duplicate scan and persist results."""
    # Load entries
    query = select(WildcardEntry, WildcardFile).join(
        WildcardFile, WildcardEntry.file_id == WildcardFile.id
    )
    rows = session.exec(query).all()

    entries = []
    for entry, wf in rows:
        if req.scope and not wf.path.startswith(req.scope):
            continue
        entries.append({"id": entry.id, "file": wf.path, "content": entry.content})
    logger.info(
        "Duplicate scan started: %d entries, threshold=%d, scope=%s",
        len(entries),
        req.threshold,
        req.scope or "all",
    )

    # Clear old pending groups
    old_groups = session.exec(
        select(DuplicateGroup).where(DuplicateGroup.status == "pending")
    ).all()
    for g in old_groups:
        for m in session.exec(select(DuplicateMember).where(DuplicateMember.group_id == g.id)).all():
            session.delete(m)
        session.delete(g)
    session.commit()

    # Run detection
    groups = find_duplicates(entries, threshold=req.threshold)
    logger.info("Duplicate scan matched %d groups.", len(groups))

    # Persist
    for g in groups:
        db_group = DuplicateGroup(status="pending")
        session.add(db_group)
        session.flush()
        for m in g.members:
            session.add(DuplicateMember(
                group_id=db_group.id,
                entry_id=m.entry_id,
                similarity=m.similarity,
            ))
    session.commit()
    logger.info("Duplicate scan persisted %d groups.", len(groups))

    return {
        "groups_found": len(groups),
        "entries_scanned": len(entries),
        "threshold": req.threshold,
    }


@router.get("/groups")
def list_groups(
    page: int = 1,
    limit: int = 100,
    status: Optional[str] = "pending",
    session: Session = Depends(get_session),
):
    """List duplicate groups with pagination.

    Large libraries can produce tens of thousands of duplicate groups. Returning
    all of them at once made the UI time out after successful scans.
    """
    page = max(1, page)
    limit = max(1, min(limit, 500))
    status_filter = status if status in {"pending", "merged", "ignored"} else None
    base_query = select(DuplicateGroup)
    count_query = select(func.count()).select_from(DuplicateGroup)
    if status_filter:
        base_query = base_query.where(DuplicateGroup.status == status_filter)
        count_query = count_query.where(DuplicateGroup.status == status_filter)

    total = session.exec(count_query).one()
    pending_count = session.exec(
        select(func.count()).select_from(DuplicateGroup).where(DuplicateGroup.status == "pending")
    ).one()
    done_count = session.exec(
        select(func.count()).select_from(DuplicateGroup).where(DuplicateGroup.status != "pending")
    ).one()
    groups = session.exec(
        base_query
        .order_by(DuplicateGroup.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()
    return {
        "items": _serialize_groups(session, groups),
        "page": page,
        "limit": limit,
        "total": total,
        "pending": pending_count,
        "done": done_count,
    }


@router.get("/groups/{group_id}")
def get_group(group_id: int, session: Session = Depends(get_session)):
    g = session.get(DuplicateGroup, group_id)
    if not g:
        raise HTTPException(404, "Group not found")
    return _serialize_groups(session, [g])[0]


@router.post("/groups/{group_id}/merge")
def merge_group(group_id: int, body: dict = None, session: Session = Depends(get_session)):
    g = session.get(DuplicateGroup, group_id)
    if not g:
        raise HTTPException(404, "Group not found")
    g.status = "merged"
    session.commit()
    return {"ok": True}


@router.post("/groups/{group_id}/ignore")
def ignore_group(group_id: int, session: Session = Depends(get_session)):
    g = session.get(DuplicateGroup, group_id)
    if not g:
        raise HTTPException(404, "Group not found")
    g.status = "ignored"
    session.commit()
    return {"ok": True}


@router.post("/batch")
def batch_action(body: BatchAction, session: Session = Depends(get_session)):
    updated = 0
    for gid in body.group_ids:
        g = session.get(DuplicateGroup, gid)
        if g:
            g.status = body.action if body.action in ("merged", "ignored") else "pending"
            updated += 1
    session.commit()
    return {"updated": updated}


def _serialize_groups(session: Session, groups: list[DuplicateGroup]) -> list[dict]:
    group_ids = [group.id for group in groups if group.id is not None]
    if not group_ids:
        return []
    members_raw = session.exec(
        select(DuplicateMember).where(DuplicateMember.group_id.in_(group_ids))
    ).all()
    entry_ids = [member.entry_id for member in members_raw if member.entry_id is not None]
    entries = session.exec(
        select(WildcardEntry).where(WildcardEntry.id.in_(entry_ids))
    ).all() if entry_ids else []
    file_ids = [entry.file_id for entry in entries if entry.file_id is not None]
    files = session.exec(
        select(WildcardFile).where(WildcardFile.id.in_(file_ids))
    ).all() if file_ids else []
    entry_by_id = {entry.id: entry for entry in entries}
    file_by_id = {file.id: file for file in files}
    members_by_group: dict[int, list[dict]] = {group_id: [] for group_id in group_ids}
    for member in members_raw:
        entry = entry_by_id.get(member.entry_id)
        wf = file_by_id.get(entry.file_id) if entry else None
        if entry and wf and member.group_id is not None:
            members_by_group.setdefault(member.group_id, []).append({
                "entry_id": member.entry_id,
                "file": wf.path,
                "content": entry.content,
                "similarity": member.similarity,
            })
    return [
        {
            "id": group.id,
            "type": "exact" if all((member.get("similarity") or 0) >= 0.999 for member in members_by_group.get(group.id, [])) else "fuzzy",
            "status": group.status,
            "members": members_by_group.get(group.id, []),
        }
        for group in groups
    ]
