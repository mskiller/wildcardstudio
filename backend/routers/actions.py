"""Non-destructive previews for cleanup actions."""
import hashlib
import re
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models.scan import DuplicateGroup as DBDuplicateGroup
from models.scan import DuplicateMember
from models.wildcard import WildcardEntry, WildcardFile

router = APIRouter()


class PreviewRequest(BaseModel):
    action: str = "dedupe_cleanup"
    threshold: int = 85
    scope: Optional[str] = None
    source: str = "auto"  # auto | persisted | scan
    max_groups: int = 100


def _normalize(text: str) -> str:
    text = re.sub(r"\(([^)]+):\d+(?:\.\d+)?\)", r"\1", text)
    text = text.lower().strip()
    return re.sub(r"\s+", " ", text)


def _member_payload(entry: WildcardEntry, wf: WildcardFile, similarity: float) -> dict:
    return {
        "entry_id": entry.id,
        "file": wf.path,
        "line_number": entry.line_number,
        "content": entry.content,
        "similarity": similarity,
    }


def _choose_canonical(members: list[dict]) -> dict:
    return sorted(
        members,
        key=lambda member: (
            member.get("file") or "",
            member.get("line_number") or 0,
            member.get("entry_id") or 0,
        ),
    )[0]


def _build_preview_group(group_id: Optional[int], group_type: str, members: list[dict]) -> dict:
    canonical = _choose_canonical(members)
    proposed_actions = []
    for member in members:
        if member["entry_id"] == canonical["entry_id"]:
            proposed_actions.append({
                "type": "keep",
                "target": member,
                "reason": "canonical first by file path, line number, entry id",
            })
        else:
            proposed_actions.append({
                "type": "remove_duplicate",
                "target": member,
                "reason": "duplicate of canonical entry",
            })
    confidence = min((member.get("similarity") or 0 for member in members), default=0)
    return {
        "group_id": group_id,
        "type": group_type,
        "confidence": confidence,
        "canonical_strategy": "first_by_file_line",
        "canonical": canonical,
        "members": members,
        "proposed_actions": proposed_actions,
    }


def _entries_for_scope(session: Session, scope: Optional[str]) -> list[tuple[WildcardEntry, WildcardFile]]:
    rows = session.exec(
        select(WildcardEntry, WildcardFile).join(
            WildcardFile, WildcardEntry.file_id == WildcardFile.id
        )
    ).all()
    if not scope:
        return rows
    normalized_scope = scope.replace("\\", "/").strip().lstrip("/")
    return [(entry, wf) for entry, wf in rows if wf.path.startswith(normalized_scope)]


def _preview_from_persisted(session: Session, req: PreviewRequest) -> list[dict]:
    groups = session.exec(
        select(DBDuplicateGroup).where(DBDuplicateGroup.status == "pending")
    ).all()
    previews = []
    for group in groups:
        raw_members = session.exec(
            select(DuplicateMember).where(DuplicateMember.group_id == group.id)
        ).all()
        members = []
        for raw in raw_members:
            entry = session.get(WildcardEntry, raw.entry_id)
            wf = session.get(WildcardFile, entry.file_id) if entry and entry.file_id else None
            if not entry or not wf:
                continue
            if req.scope and not wf.path.startswith(req.scope.replace("\\", "/").strip().lstrip("/")):
                continue
            members.append(_member_payload(entry, wf, raw.similarity or 0.0))
        if len(members) > 1:
            group_type = "exact" if all((member.get("similarity") or 0) >= 0.999 for member in members) else "fuzzy"
            previews.append(_build_preview_group(group.id, group_type, members))
        if len(previews) >= req.max_groups:
            break
    return previews


def _preview_from_scan(session: Session, req: PreviewRequest) -> tuple[list[dict], int]:
    rows = _entries_for_scope(session, req.scope)
    entries = [{"id": entry.id, "file": wf.path, "content": entry.content} for entry, wf in rows]
    try:
        from services.fuzzy_matcher import find_duplicates

        groups = find_duplicates(entries, threshold=req.threshold)
    except Exception:
        groups = _find_exact_duplicates(entries)

    entry_lookup = {entry.id: (entry, wf) for entry, wf in rows}
    previews = []
    for group in groups:
        members = []
        for raw_member in group.members:
            entry, wf = entry_lookup.get(raw_member.entry_id, (None, None))
            if entry and wf:
                members.append(_member_payload(entry, wf, raw_member.similarity))
        if len(members) > 1:
            previews.append(_build_preview_group(None, group.type, members))
        if len(previews) >= req.max_groups:
            break
    return previews, len(entries)


def _find_exact_duplicates(entries: list[dict]):
    class Member:
        def __init__(self, entry_id: int, similarity: float):
            self.entry_id = entry_id
            self.similarity = similarity

    class Group:
        def __init__(self, members: list[Member]):
            self.type = "exact"
            self.members = members

    buckets = {}
    for entry in entries:
        digest = hashlib.md5(_normalize(entry["content"]).encode("utf-8")).hexdigest()
        buckets.setdefault(digest, []).append(entry)
    return [
        Group([Member(entry["id"], 1.0) for entry in bucket])
        for bucket in buckets.values()
        if len(bucket) > 1
    ]


@router.post("/preview")
def preview_actions(body: Optional[PreviewRequest] = None, session: Session = Depends(get_session)):
    req = body or PreviewRequest()
    if req.action != "dedupe_cleanup":
        return {
            "action": req.action,
            "source": "none",
            "summary": {"groups": 0, "proposed_removals": 0, "entries_considered": 0},
            "groups": [],
            "note": "Only dedupe_cleanup previews are currently supported.",
        }

    groups = [] if req.source == "scan" else _preview_from_persisted(session, req)
    source = "persisted_duplicate_groups" if groups else "direct_duplicate_scan"
    entries_considered = 0
    if not groups and req.source != "persisted":
        groups, entries_considered = _preview_from_scan(session, req)
    elif groups:
        entries_considered = sum(len(group["members"]) for group in groups)

    proposed_removals = sum(
        1
        for group in groups
        for action in group["proposed_actions"]
        if action["type"] == "remove_duplicate"
    )
    return {
        "action": "dedupe_cleanup",
        "source": source,
        "threshold": req.threshold,
        "scope": req.scope,
        "summary": {
            "groups": len(groups),
            "proposed_removals": proposed_removals,
            "entries_considered": entries_considered,
        },
        "groups": groups,
    }
