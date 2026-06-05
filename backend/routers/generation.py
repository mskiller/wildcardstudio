import json
import os
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from config import get_settings
from database import get_session
from models.prompt import GenerationHistory
from services import generation_connector
from services.time_utils import utc_now

router = APIRouter()
settings = get_settings()


class LoraSelection(BaseModel):
    name: str
    weight: float = 1.0
    enabled: bool = True


class Txt2ImgRequest(BaseModel):
    provider: Literal["comfyui", "sdforge"] = "sdforge"
    base_url: Optional[str] = None
    prompt: str = Field(min_length=1)
    negative_prompt: Optional[str] = None
    model: Optional[str] = None
    sampler: Optional[str] = None
    scheduler: Optional[str] = None
    steps: int = Field(default=30, ge=1, le=200)
    cfg_scale: float = Field(default=7.0, ge=0, le=30)
    seed: int = -1
    width: int = Field(default=1024, ge=64, le=4096)
    height: int = Field(default=1024, ge=64, le=4096)
    batch_size: int = Field(default=1, ge=1, le=16)
    batch_count: int = Field(default=1, ge=1, le=16)
    loras: List[LoraSelection] = Field(default_factory=list)


@router.get("/capabilities")
def get_capabilities(
    provider: Literal["comfyui", "sdforge"] = Query("sdforge"),
    base_url: Optional[str] = Query(None),
):
    return generation_connector.discover_capabilities(provider, base_url)


@router.get("/settings")
def get_settings_from_connector(
    provider: Literal["comfyui", "sdforge"] = Query("sdforge"),
    base_url: Optional[str] = Query(None),
):
    return generation_connector.discover_settings(provider, base_url)


@router.get("/defaults")
def get_generation_defaults(
    provider: Literal["comfyui", "sdforge"] = Query("sdforge"),
    base_url: Optional[str] = Query(None),
):
    return generation_connector.generation_defaults(provider, base_url)


@router.post("/txt2img")
def txt2img(body: Txt2ImgRequest, session: Session = Depends(get_session)):
    request_data = body.model_dump()
    provider = request_data["provider"]
    base_url = generation_connector.normalize_base_url(provider, request_data.get("base_url"))

    try:
        if provider == "comfyui":
            connector_response = generation_connector.comfyui_txt2img({**request_data, "base_url": base_url})
        else:
            connector_response = generation_connector.sdforge_txt2img({**request_data, "base_url": base_url})
        images = connector_response.get("images") or []
        saved_paths = generation_connector.save_generation_images(images, settings.backups_path)
        parameters = connector_response.get("parameters") if isinstance(connector_response.get("parameters"), dict) else {}
        record = GenerationHistory(
            provider=provider,
            base_url=base_url,
            prompt=body.prompt,
            negative_prompt=body.negative_prompt,
            model=body.model or parameters.get("model"),
            sampler=body.sampler or parameters.get("sampler"),
            scheduler=body.scheduler or parameters.get("scheduler"),
            steps=parameters.get("steps", body.steps),
            cfg_scale=parameters.get("cfg_scale", body.cfg_scale),
            seed=parameters.get("seed", body.seed),
            width=parameters.get("width", body.width),
            height=parameters.get("height", body.height),
            loras_json=json.dumps([lora.model_dump() for lora in body.loras]),
            images_json=json.dumps(saved_paths),
            metadata_json=json.dumps(
                {
                    "request": _public_request_metadata(request_data, base_url),
                    "response": _public_response_metadata(connector_response),
                }
            ),
            status="completed",
            created_at=utc_now(),
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return {
            "id": record.id,
            "provider": record.provider,
            "base_url": record.base_url,
            "image_count": len(saved_paths),
            "images": [{"index": index, "history_image_url": f"/generation/history/{record.id}/image?image_index={index}"} for index, _ in enumerate(saved_paths)],
            "metadata": json.loads(record.metadata_json or "{}"),
        }
    except HTTPException as exc:
        _persist_failed_generation(session, body, base_url, str(exc.detail))
        raise
    except Exception as exc:
        _persist_failed_generation(session, body, base_url, str(exc))
        raise HTTPException(status_code=500, detail=f"generation failed: {exc}") from exc


@router.get("/history")
def list_history(
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    records = session.exec(
        select(GenerationHistory).order_by(GenerationHistory.created_at.desc()).limit(limit)
    ).all()
    return {"items": [_serialize_history(record) for record in records]}


@router.get("/history/{history_id}/image")
def get_history_image(
    history_id: int,
    image_index: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    record = session.get(GenerationHistory, history_id)
    if not record:
        raise HTTPException(status_code=404, detail="generation history record not found")
    paths = _load_json_list(record.images_json)
    if image_index >= len(paths):
        raise HTTPException(status_code=404, detail="generation image not found")
    image_path = paths[image_index]
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="generation image file missing")
    media_type = "image/jpeg" if image_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
    return FileResponse(image_path, media_type=media_type, filename=os.path.basename(image_path))


def _persist_failed_generation(session: Session, body: Txt2ImgRequest, base_url: str, error: str) -> None:
    record = GenerationHistory(
        provider=body.provider,
        base_url=base_url,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        model=body.model,
        sampler=body.sampler,
        scheduler=body.scheduler,
        steps=body.steps,
        cfg_scale=body.cfg_scale,
        seed=body.seed,
        width=body.width,
        height=body.height,
        loras_json=json.dumps([lora.model_dump() for lora in body.loras]),
        images_json=json.dumps([]),
        status="failed",
        error=error,
        created_at=utc_now(),
    )
    session.add(record)
    session.commit()


def _serialize_history(record: GenerationHistory) -> Dict[str, Any]:
    paths = _load_json_list(record.images_json)
    return {
        "id": record.id,
        "provider": record.provider,
        "base_url": record.base_url,
        "prompt": record.prompt,
        "negative_prompt": record.negative_prompt,
        "model": record.model,
        "sampler": record.sampler,
        "scheduler": record.scheduler,
        "steps": record.steps,
        "cfg_scale": record.cfg_scale,
        "seed": record.seed,
        "width": record.width,
        "height": record.height,
        "loras": _load_json_list(record.loras_json),
        "images": [
            {"index": index, "history_image_url": f"/generation/history/{record.id}/image?image_index={index}"}
            for index, _ in enumerate(paths)
        ],
        "image_count": len(paths),
        "status": record.status,
        "error": record.error,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def _public_request_metadata(request_data: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    metadata = dict(request_data)
    metadata["base_url"] = base_url
    return metadata


def _public_response_metadata(response: Dict[str, Any]) -> Dict[str, Any]:
    metadata = {key: value for key, value in response.items() if key != "images"}
    metadata["image_count"] = len(response.get("images") or [])
    return metadata


def _load_json_list(value: Optional[str]) -> List[Any]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []
