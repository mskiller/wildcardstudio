"""F08 · Générateur de wildcards"""
import os
import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from config import get_settings
from database import get_session
from models.wildcard import WildcardFile, WildcardEntry
from services.fuzzy_matcher import find_duplicates
from services.file_watcher import index_file
from services.wildcard_processor import process_prompt

router = APIRouter()
settings = get_settings()


class ProcessPromptRequest(BaseModel):
    prompt: str
    count: int = 1


class GeneratorPreviewRequest(BaseModel):
    name: str
    format: str = "impact"       # 'impact' | 'dynamic_prompts'
    style: str = "tag"           # 'tag' | 'nl'
    entries: List[str]


class GeneratorCreateRequest(GeneratorPreviewRequest):
    target_folder: str = ""


@router.post("/process-prompt")
def process_prompt_endpoint(req: ProcessPromptRequest, session: Session = Depends(get_session)):
    """Resolve wildcards and curly braces in the given prompt."""
    results = []
    for _ in range(req.count):
        results.append(process_prompt(session, req.prompt))
    return {"original": req.prompt, "processed": results}


@router.get("/suggestions")
def get_suggestions(
    category: Optional[str] = None,
    format: str = "impact",
    session: Session = Depends(get_session),
):
    """Return existing entries similar to the given category."""
    files = session.exec(select(WildcardFile)).all()
    results = []
    for f in files:
        if category and category.lower() not in f.path.lower():
            continue
        entries = session.exec(
            select(WildcardEntry).where(WildcardEntry.file_id == f.id)
        ).all()
        results.extend([{"content": e.content, "file": f.path} for e in entries[:5]])
    return {"suggestions": results[:50]}


@router.post("/preview")
def preview_wildcard(req: GeneratorPreviewRequest):
    """Generate YAML/TXT preview of the wildcard being built."""
    clean_name = req.name.strip().replace(" ", "_").lower()
    if req.format == "dynamic_prompts":
        data = {f"__{clean_name}__": req.entries}
        content = yaml.dump(data, allow_unicode=True, default_flow_style=False)
    else:
        # Impact: flat list in YAML or TXT
        if req.name.endswith(".txt"):
            content = "\n".join(req.entries)
        else:
            content = yaml.dump(req.entries, allow_unicode=True, default_flow_style=False)
    return {"name": clean_name, "format": req.format, "preview": content}


@router.post("/create")
def create_wildcard(req: GeneratorCreateRequest, session: Session = Depends(get_session)):
    """Write the wildcard file to disk and index it."""
    clean_name = req.name.strip().replace(" ", "_").lower()
    ext = ".txt" if req.format == "impact" and req.name.endswith(".txt") else ".yaml"
    filename = f"{clean_name}{ext}"
    folder = req.target_folder.strip("/")
    rel_path = os.path.join(folder, filename).replace("\\", "/") if folder else filename
    full_path = os.path.join(settings.wildcards_path, rel_path)

    if os.path.exists(full_path):
        raise HTTPException(409, f"File already exists: {rel_path}")

    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    if req.format == "dynamic_prompts":
        data = {f"__{clean_name}__": req.entries}
        content = yaml.dump(data, allow_unicode=True, default_flow_style=False)
    else:
        content = yaml.dump(req.entries, allow_unicode=True, default_flow_style=False)

    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)

    wf = index_file(full_path, session)
    return {"ok": True, "path": rel_path, "entry_count": wf.entry_count}
