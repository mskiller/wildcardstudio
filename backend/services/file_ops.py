import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

from fastapi import HTTPException

from config import get_settings

settings = get_settings()
ALLOWED_EXTENSIONS = {".txt", ".yaml", ".yml"}


def _line_count(content: str) -> int:
    if not content:
        return 0
    return content.count("\n") + 1


def resolve_wildcard_path(file_path: str) -> Path:
    if not file_path or not file_path.strip():
        raise HTTPException(status_code=400, detail="file is required")

    requested = Path(file_path.replace("\\", "/"))
    if requested.is_absolute():
        raise HTTPException(status_code=400, detail="absolute paths are not allowed")

    if requested.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="invalid file extension")

    base = Path(settings.wildcards_path).resolve()
    candidate = (base / requested).resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="path traversal is not allowed")

    return candidate


def build_file_metadata(path: Path, content: str) -> Dict[str, object]:
    stat = path.stat()
    return {
        "path": str(path.relative_to(Path(settings.wildcards_path).resolve())).replace("\\", "/"),
        "name": path.name,
        "extension": path.suffix.lower(),
        "content": content,
        "line_count": _line_count(content),
        "size": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "writable": os.access(path, os.W_OK),
    }


def read_file_content(file_path: str) -> Dict[str, object]:
    resolved = resolve_wildcard_path(file_path)
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    content = resolved.read_text(encoding="utf-8", errors="replace")
    return build_file_metadata(resolved, content)


def save_file_content(file_path: str, content: str, backup: bool = True) -> Dict[str, object]:
    resolved = resolve_wildcard_path(file_path)
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if not os.access(resolved, os.W_OK):
        raise HTTPException(status_code=403, detail="file is not writable")

    if backup:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = Path(settings.backups_path) / "editor"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_target = backup_dir / f"{resolved.stem}.{timestamp}{resolved.suffix}"
        shutil.copy2(resolved, backup_target)

    resolved.write_text(content or "", encoding="utf-8")
    written = resolved.read_text(encoding="utf-8", errors="replace")
    return build_file_metadata(resolved, written)
