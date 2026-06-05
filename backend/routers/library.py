"""F07 · Bibliothèque de prompts"""
import os
import json
import shutil
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from sqlmodel import Session, select

from config import get_settings
from database import get_session
from models.prompt import PromptLibrary
from models.wildcard import WildcardEntry, WildcardFile
from services.time_utils import utc_now
from services.token_counter import count_tokens
from services.nl_detector import detect_style

router = APIRouter()
settings = get_settings()

IMAGES_DIR = os.path.join(settings.backups_path, "library-images")


class PromptCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    title: Optional[str] = None
    content: str
    prompt_style: Optional[str] = None
    model_target: Optional[str] = None
    rating: Optional[int] = None
    notes: Optional[str] = None
    tags_json: Optional[str] = None
    collection: Optional[str] = None


class PromptUpdate(PromptCreate):
    content: Optional[str] = None


@router.get("/")
def list_prompts(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("created_at"),
    model: Optional[str] = None,
    collection: Optional[str] = None,
    q: Optional[str] = None,
    session: Session = Depends(get_session),
):
    prompts = session.exec(select(PromptLibrary)).all()
    if not prompts:
        return _list_wildcard_prompts(session, page, limit, sort, model, collection, q)

    if model:
        prompts = [p for p in prompts if p.model_target == model]
    if collection:
        prompts = [p for p in prompts if p.collection == collection]
    if q:
        q_lower = q.lower()
        prompts = [
            p for p in prompts
            if (p.content and q_lower in p.content.lower())
            or (p.title and q_lower in p.title.lower())
            or (p.notes and q_lower in p.notes.lower())
        ]
    # Sort
    if sort == "rating":
        prompts.sort(key=lambda p: p.rating or 0, reverse=True)
    else:
        prompts.sort(key=lambda p: p.created_at, reverse=True)
    # Paginate
    total = len(prompts)
    start = (page - 1) * limit
    return {"total": total, "page": page, "items": prompts[start: start + limit]}


@router.post("/")
def create_prompt(body: PromptCreate, session: Session = Depends(get_session)):
    style = body.prompt_style
    if not style:
        style, _, _ = detect_style(body.content)
    tc = count_tokens(body.content)
    p = PromptLibrary(
        **body.dict(),
        prompt_style=style,
        token_count=tc["clip_tokens"],
        created_at=utc_now(),
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@router.get("/collections")
def list_collections(session: Session = Depends(get_session)):
    prompts = session.exec(select(PromptLibrary)).all()
    if not prompts:
        collections = sorted({
            _wildcard_collection(file.path)
            for file in session.exec(select(WildcardFile)).all()
            if _wildcard_collection(file.path)
        })
        return {"collections": collections}
    collections = list({p.collection for p in prompts if p.collection})
    return {"collections": sorted(collections)}


@router.get("/{prompt_id}")
def get_prompt(prompt_id: int, session: Session = Depends(get_session)):
    p = session.get(PromptLibrary, prompt_id)
    if not p:
        raise HTTPException(404, "Prompt not found")
    return p


@router.put("/{prompt_id}")
def update_prompt(prompt_id: int, body: PromptUpdate, session: Session = Depends(get_session)):
    p = session.get(PromptLibrary, prompt_id)
    if not p:
        raise HTTPException(404, "Prompt not found")
    for k, v in body.dict(exclude_unset=True, exclude_none=True).items():
        setattr(p, k, v)
    p.updated_at = utc_now()
    if body.content:
        tc = count_tokens(body.content)
        p.token_count = tc["clip_tokens"]
    session.commit()
    session.refresh(p)
    return p


@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: int, session: Session = Depends(get_session)):
    p = session.get(PromptLibrary, prompt_id)
    if not p:
        raise HTTPException(404, "Prompt not found")
    session.delete(p)
    session.commit()
    return {"ok": True}


@router.post("/{prompt_id}/image")
async def upload_image(prompt_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)):
    p = session.get(PromptLibrary, prompt_id)
    if not p:
        raise HTTPException(404, "Prompt not found")
    os.makedirs(IMAGES_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or ".jpg")[1]
    dest = os.path.join(IMAGES_DIR, f"prompt_{prompt_id}{ext}")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    p.image_path = dest
    p.updated_at = utc_now()
    session.commit()
    return {"ok": True, "image_path": dest}


def _list_wildcard_prompts(
    session: Session,
    page: int,
    limit: int,
    sort: str,
    model: Optional[str],
    collection: Optional[str],
    q: Optional[str],
):
    rows = session.exec(
        select(WildcardEntry, WildcardFile)
        .where(WildcardEntry.file_id == WildcardFile.id)
    ).all()
    items = [
        _wildcard_prompt_item(entry, file, index)
        for index, (entry, file) in enumerate(rows)
        if entry.content and entry.content.strip()
    ]
    if model:
        items = [item for item in items if item["model_target"] == model]
    if collection:
        items = [item for item in items if item["collection"] == collection]
    if q:
        q_lower = q.lower()
        items = [
            item for item in items
            if q_lower in item["content"].lower()
            or (item["title"] and q_lower in item["title"].lower())
            or (item["notes"] and q_lower in item["notes"].lower())
        ]
    if sort == "rating":
        items.sort(key=lambda item: item["rating"] or 0, reverse=True)
    else:
        items.sort(key=lambda item: item["created_at"], reverse=True)

    total = len(items)
    start = (page - 1) * limit
    return {"total": total, "page": page, "items": items[start: start + limit]}


def _wildcard_prompt_item(entry: WildcardEntry, file: WildcardFile, index: int) -> dict:
    created_at = file.last_scanned or file.last_modified or utc_now()
    title_line = f":{entry.line_number}" if entry.line_number else ""
    return {
        "id": -(entry.id or index + 1),
        "title": f"{file.filename}{title_line}",
        "content": entry.content,
        "prompt_style": entry.prompt_style or file.prompt_style,
        "model_target": _infer_model_target(file.path, entry.content),
        "rating": None,
        "notes": f"Indexed wildcard: {file.path}{title_line}",
        "image_path": None,
        "tags_json": entry.tag_signature,
        "collection": _wildcard_collection(file.path),
        "token_count": len(entry.content.split()),
        "created_at": created_at,
        "updated_at": file.last_modified,
    }


def _wildcard_collection(path: str) -> Optional[str]:
    folder = os.path.dirname(path.replace("\\", "/"))
    return folder or None


def _infer_model_target(path: str, content: str) -> Optional[str]:
    haystack = f"{path} {content}".lower()
    if "illustrious" in haystack:
        return "illustrious"
    if "noobai" in haystack or "noob" in haystack:
        return "noobai"
    if "sdxl" in haystack:
        return "sdxl"
    return "other"
