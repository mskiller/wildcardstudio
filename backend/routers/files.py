from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.file_ops import read_file_content, save_file_content, resolve_wildcard_path

router = APIRouter()


class SaveFileBody(BaseModel):
    file: str
    content: str
    backup: bool = True


@router.get("/content")
def get_content(file: str = Query(...)):
    return read_file_content(file)


@router.put("/content")
def put_content(body: SaveFileBody):
    return save_file_content(body.file, body.content, body.backup)


@router.get("/export")
def export_file(file: str = Query(...)):
    resolved = resolve_wildcard_path(file)
    if not resolved.exists() or not resolved.is_file():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(
        path=str(resolved),
        filename=resolved.name,
        media_type="application/octet-stream",
    )
