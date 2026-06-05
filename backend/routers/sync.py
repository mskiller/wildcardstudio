"""F10 · Export / Import & Sync"""
import os
import io
import zipfile
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from config import get_settings
from database import get_session
from models.wildcard import WildcardFile
from services.syntax_converter import impact_to_dynamic, dynamic_to_impact, convert_inline_syntax
from services import git_manager
from services.file_watcher import index_file
from services.time_utils import utc_now

router = APIRouter()
settings = get_settings()


class ConvertRequest(BaseModel):
    text: str
    direction: str = "impact_to_dynamic"   # 'impact_to_dynamic' | 'dynamic_to_impact'
    wildcard_name: str = "wildcard"
    mode: str = "file"                     # 'file' | 'inline'


class ExportRequest(BaseModel):
    folder: Optional[str] = None           # None = all
    style_filter: Optional[str] = None     # 'tag' | 'nl' | None = all


class GitCommitRequest(BaseModel):
    message: str = "WildcardStudio: update wildcards"


class GitDiffRequest(BaseModel):
    commit_a: Optional[str] = None
    commit_b: Optional[str] = None


@router.post("/convert")
def convert_syntax(req: ConvertRequest):
    if req.mode == "inline":
        result = convert_inline_syntax(req.text, req.direction)
    elif req.direction == "impact_to_dynamic":
        result = impact_to_dynamic(req.text, req.wildcard_name)
    else:
        result = dynamic_to_impact(req.text)
    return {"result": result, "direction": req.direction}


@router.post("/export")
def export_wildcards(req: ExportRequest, session: Session = Depends(get_session)):
    """Create a ZIP of selected wildcards."""
    files = session.exec(select(WildcardFile)).all()
    if req.folder:
        files = [f for f in files if f.path.startswith(req.folder)]
    if req.style_filter:
        files = [f for f in files if f.prompt_style == req.style_filter]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for wf in files:
            full = os.path.join(settings.wildcards_path, wf.path)
            if os.path.exists(full):
                zf.write(full, wf.path)
    buf.seek(0)
    filename = f"wildcards_{utc_now().strftime('%Y%m%d_%H%M%S')}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import")
async def import_wildcards(
    file: UploadFile = File(...),
    destination: str = "",
    session: Session = Depends(get_session),
):
    """Import a ZIP archive of wildcards."""
    dest_base = os.path.join(settings.wildcards_path, destination.strip("/"))
    os.makedirs(dest_base, exist_ok=True)

    content = await file.read()
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        imported = []
        for name in zf.namelist():
            if name.endswith((".yaml", ".yml", ".txt")):
                dest_path = os.path.join(dest_base, name)
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                with open(dest_path, "wb") as f:
                    f.write(zf.read(name))
                try:
                    index_file(dest_path, session)
                    imported.append(name)
                except Exception:
                    pass

    return {"imported": len(imported), "files": imported}


@router.post("/git/commit")
def git_commit(req: GitCommitRequest):
    if not git_manager.is_enabled():
        raise HTTPException(400, "Git versioning is disabled")
    hash_ = git_manager.commit(req.message)
    if hash_ is None:
        return {"ok": False, "message": "Nothing to commit"}
    return {"ok": True, "hash": hash_}


@router.get("/git/log")
def git_log(n: int = 20):
    if not git_manager.is_enabled():
        raise HTTPException(400, "Git versioning is disabled")
    return {"commits": git_manager.get_log(n)}


@router.post("/git/diff")
def git_diff(req: GitDiffRequest):
    if not git_manager.is_enabled():
        raise HTTPException(400, "Git versioning is disabled")
    diff = git_manager.diff(req.commit_a, req.commit_b)
    return {"diff": diff}


@router.post("/backup")
def manual_backup():
    """Create a manual ZIP backup of all wildcards."""
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(settings.backups_path, f"backup_{timestamp}.zip")
    os.makedirs(settings.backups_path, exist_ok=True)

    with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(settings.wildcards_path):
            dirs[:] = [d for d in dirs if d != ".git"]
            for fname in files:
                if fname.endswith((".yaml", ".yml", ".txt")):
                    full = os.path.join(root, fname)
                    rel = os.path.relpath(full, settings.wildcards_path)
                    zf.write(full, rel)

    return {"ok": True, "backup_path": backup_path}
