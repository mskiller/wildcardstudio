"""F05 · Détecteur de doublons"""
import json
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from database import get_session
from models.wildcard import WildcardEntry, WildcardFile
from models.scan import DuplicateGroup, DuplicateMember
from services.fuzzy_matcher import find_duplicates

router = APIRouter()


class ScanRequest(BaseModel):
    threshold: int = 85
    scope: Optional[str] = None  # None = all, or folder path


class BatchAction(BaseModel):
    group_ids: List[int]
    action: str  # 'ignore' | 'merge'


@router.post("/scan")
async def scan_duplicates(req: ScanRequest, session: Session = Depends(get_session)):
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

    return {
        "groups_found": len(groups),
        "entries_scanned": len(entries),
        "threshold": req.threshold,
    }


@router.get("/groups")
def list_groups(session: Session = Depends(get_session)):
    groups = session.exec(select(DuplicateGroup)).all()
    result = []
    for g in groups:
        members_raw = session.exec(
            select(DuplicateMember).where(DuplicateMember.group_id == g.id)
        ).all()
        members = []
        for m in members_raw:
            entry = session.get(WildcardEntry, m.entry_id)
            wf = session.get(WildcardFile, entry.file_id) if entry else None
            if entry and wf:
                members.append({
                    "entry_id": m.entry_id,
                    "file": wf.path,
                    "content": entry.content,
                    "similarity": m.similarity,
                })
        result.append({
            "id": g.id,
            "type": "exact" if all(m["similarity"] == 1.0 for m in members) else "fuzzy",
            "status": g.status,
            "members": members,
        })
    return result


@router.get("/groups/{group_id}")
def get_group(group_id: int, session: Session = Depends(get_session)):
    g = session.get(DuplicateGroup, group_id)
    if not g:
        raise HTTPException(404, "Group not found")
    members_raw = session.exec(
        select(DuplicateMember).where(DuplicateMember.group_id == group_id)
    ).all()
    members = []
    for m in members_raw:
        entry = session.get(WildcardEntry, m.entry_id)
        wf = session.get(WildcardFile, entry.file_id) if entry else None
        if entry and wf:
            members.append({
                "entry_id": m.entry_id,
                "file": wf.path,
                "content": entry.content,
                "similarity": m.similarity,
            })
    return {"id": g.id, "status": g.status, "members": members}


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
