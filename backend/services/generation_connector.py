import base64
import json
import os
import random
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

from fastapi import HTTPException


SUPPORTED_PROVIDERS = {"comfyui", "sdforge"}
LOCAL_CONNECTOR_HOSTS = {"127.0.0.1", "localhost", "0.0.0.0", "::1"}
DOCKER_HOST_GATEWAY = "host.docker.internal"

SDXL_RESOLUTIONS = [
    {"label": "SDXL Square", "width": 1024, "height": 1024},
    {"label": "SDXL Portrait", "width": 832, "height": 1216},
    {"label": "SDXL Landscape", "width": 1216, "height": 832},
    {"label": "SDXL Tall", "width": 768, "height": 1344},
    {"label": "SDXL Wide", "width": 1344, "height": 768},
    {"label": "SDXL Cinematic", "width": 1536, "height": 640},
]


def default_base_url(provider: str) -> str:
    provider = validate_provider(provider)
    if provider == "comfyui":
        return "http://127.0.0.1:8188"
    return "http://127.0.0.1:7860"


def validate_provider(provider: str) -> str:
    normalized = (provider or "").strip().lower()
    if normalized not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail="unsupported generation provider")
    return normalized


def normalize_base_url(provider: str, base_url: Optional[str]) -> str:
    value = (base_url or default_base_url(provider)).strip()
    if not value:
        value = default_base_url(provider)
    if not value.startswith(("http://", "https://")):
        value = f"http://{value}"
    return value.rstrip("/")


def connector_base_url(provider: str, base_url: Optional[str]) -> str:
    return _docker_host_base_url(normalize_base_url(provider, base_url))


def request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 8.0,
) -> Any:
    url = urljoin(f"{base_url.rstrip('/')}/", path.lstrip("/"))
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(
            status_code=502,
            detail=f"generation connector returned HTTP {exc.code}: {detail[:300]}",
        ) from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"generation connector unreachable: {exc.reason}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="generation connector timed out") from exc
    except OSError as exc:
        raise HTTPException(status_code=502, detail=f"generation connector network error: {exc}") from exc

    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="generation connector returned invalid JSON") from exc


def request_bytes(
    base_url: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
) -> bytes:
    url = urljoin(f"{base_url.rstrip('/')}/", path.lstrip("/"))
    if params:
        url = f"{url}?{urlencode({key: value for key, value in params.items() if value is not None})}"
    req = Request(url, headers={"Accept": "image/*,*/*"}, method="GET")
    try:
        with urlopen(req, timeout=timeout) as response:
            return response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(
            status_code=502,
            detail=f"generation connector returned HTTP {exc.code}: {detail[:300]}",
        ) from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"generation connector unreachable: {exc.reason}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="generation connector timed out") from exc
    except OSError as exc:
        raise HTTPException(status_code=502, detail=f"generation connector network error: {exc}") from exc


def discover_capabilities(provider: str, base_url: Optional[str] = None) -> Dict[str, Any]:
    provider = validate_provider(provider)
    resolved_base_url = normalize_base_url(provider, base_url)
    resolved_connector_url = connector_base_url(provider, base_url)
    if provider == "comfyui":
        return discover_comfyui(resolved_base_url, resolved_connector_url)
    return discover_sdforge(resolved_base_url, resolved_connector_url)


def discover_settings(provider: str, base_url: Optional[str] = None) -> Dict[str, Any]:
    capabilities = discover_capabilities(provider, base_url)
    return {
        "provider": capabilities["provider"],
        "base_url": capabilities["base_url"],
        "reachable": capabilities["reachable"],
        "defaults": build_defaults(capabilities),
        "capabilities": capabilities,
    }


def generation_defaults(provider: str, base_url: Optional[str] = None) -> Dict[str, Any]:
    capabilities = discover_capabilities(provider, base_url)
    return {
        "provider": capabilities["provider"],
        "base_url": capabilities["base_url"],
        "reachable": capabilities["reachable"],
        "defaults": build_defaults(capabilities),
        "sdxl_resolutions": SDXL_RESOLUTIONS,
    }


def discover_comfyui(base_url: str, effective_base_url: Optional[str] = None) -> Dict[str, Any]:
    connector_url = effective_base_url or base_url
    errors: List[str] = []
    checkpoints: List[str] = []
    loras: List[str] = []
    object_info: Dict[str, Any] = {}

    checkpoints = _try_endpoint_list(connector_url, "/models/checkpoints", errors)
    loras = _try_endpoint_list(connector_url, "/models/loras", errors)
    try:
        object_info_payload = request_json(connector_url, "/object_info", timeout=8.0)
        if isinstance(object_info_payload, dict):
            object_info = object_info_payload
    except HTTPException as exc:
        errors.append(f"/object_info: {exc.detail}")

    if not checkpoints:
        checkpoints = _extract_comfyui_checkpoint_choices(object_info)
    if not loras:
        loras = _extract_comfyui_lora_choices(object_info)

    samplers, schedulers = _extract_comfyui_sampler_choices(object_info)
    node_support = _extract_comfyui_node_support(object_info)
    payload = {
        "provider": "comfyui",
        "base_url": base_url,
        "effective_base_url": connector_url,
        "reachable": bool(checkpoints or loras or object_info),
        "models": checkpoints,
        "loras": loras,
        "samplers": samplers,
        "schedulers": schedulers,
        "supports_txt2img": _supports_basic_comfyui_txt2img(node_support),
        "supports_batch_size": True,
        "supports_batch_count": True,
        "options": {
            "defaults": _extract_comfyui_defaults(object_info),
            "node_support": node_support,
            "object_info_node_count": len(object_info),
        },
        "errors": errors,
    }
    payload["defaults"] = build_defaults(payload)
    return payload


def discover_sdforge(base_url: str, effective_base_url: Optional[str] = None) -> Dict[str, Any]:
    connector_url = effective_base_url or base_url
    errors: List[str] = []
    options: Dict[str, Any] = {}
    models: List[str] = []
    samplers: List[str] = []
    schedulers: List[str] = []
    loras: List[str] = []

    try:
        options_payload = request_json(connector_url, "/sdapi/v1/options")
        if isinstance(options_payload, dict):
            options = options_payload
    except HTTPException as exc:
        errors.append(f"/sdapi/v1/options: {exc.detail}")

    models = _extract_named_items(_try_endpoint(connector_url, "/sdapi/v1/sd-models", errors))
    samplers = _extract_named_items(_try_endpoint(connector_url, "/sdapi/v1/samplers", errors))
    schedulers = _extract_named_items(_try_endpoint(connector_url, "/sdapi/v1/schedulers", errors))
    loras = _extract_named_items(_try_endpoint(connector_url, "/sdapi/v1/loras", errors))

    payload = {
        "provider": "sdforge",
        "base_url": base_url,
        "effective_base_url": connector_url,
        "reachable": bool(options or models or samplers or schedulers or loras),
        "models": models,
        "loras": loras,
        "samplers": samplers,
        "schedulers": schedulers,
        "supports_txt2img": True,
        "supports_batch_size": True,
        "supports_batch_count": True,
        "options": options,
        "errors": errors,
    }
    payload["defaults"] = build_defaults(payload)
    return payload


def build_defaults(capabilities: Dict[str, Any]) -> Dict[str, Any]:
    options = capabilities.get("options") if isinstance(capabilities.get("options"), dict) else {}
    defaults = {
        "model": _preferred_model(capabilities.get("models")),
        "sampler": _first(capabilities.get("samplers")),
        "scheduler": _first(capabilities.get("schedulers")),
        "steps": 30,
        "cfg_scale": 7.0,
        "seed": -1,
        "width": 1024,
        "height": 1024,
    }

    if capabilities.get("provider") == "sdforge":
        defaults["model"] = options.get("sd_model_checkpoint") or defaults["model"]
    elif capabilities.get("provider") == "comfyui":
        comfy_defaults = options.get("defaults") if isinstance(options.get("defaults"), dict) else {}
        defaults.update({k: v for k, v in comfy_defaults.items() if v is not None})

    return defaults


def sdforge_txt2img(request_data: Dict[str, Any]) -> Dict[str, Any]:
    provider = validate_provider(request_data.get("provider", "sdforge"))
    if provider != "sdforge":
        raise HTTPException(status_code=400, detail="sdforge_txt2img requires provider 'sdforge'")

    base_url = connector_base_url(provider, request_data.get("base_url"))
    prompt = _prompt_with_loras(request_data.get("prompt", ""), request_data.get("loras") or [])
    payload: Dict[str, Any] = {
        "prompt": prompt,
        "negative_prompt": request_data.get("negative_prompt") or "",
        "steps": request_data.get("steps", 30),
        "cfg_scale": request_data.get("cfg_scale", 7.0),
        "seed": request_data.get("seed", -1),
        "width": request_data.get("width", 1024),
        "height": request_data.get("height", 1024),
        "batch_size": request_data.get("batch_size", 1),
        "n_iter": request_data.get("batch_count", 1),
    }

    if request_data.get("sampler"):
        payload["sampler_name"] = request_data["sampler"]
    if request_data.get("scheduler"):
        payload["scheduler"] = request_data["scheduler"]
    if request_data.get("model"):
        payload["override_settings"] = {"sd_model_checkpoint": request_data["model"]}

    return request_json(base_url, "/sdapi/v1/txt2img", method="POST", payload=payload, timeout=120.0)


def comfyui_txt2img(request_data: Dict[str, Any]) -> Dict[str, Any]:
    provider = validate_provider(request_data.get("provider", "comfyui"))
    if provider != "comfyui":
        raise HTTPException(status_code=400, detail="comfyui_txt2img requires provider 'comfyui'")

    base_url = connector_base_url(provider, request_data.get("base_url"))
    model = request_data.get("model") or _first(_try_endpoint_list(base_url, "/models/checkpoints", []))
    sampler = request_data.get("sampler") or "euler"
    scheduler = request_data.get("scheduler") or "normal"
    if not model:
        raise HTTPException(status_code=400, detail="ComfyUI txt2img requires a checkpoint model")

    seed = _normalize_seed(request_data.get("seed", -1))
    workflow = build_comfyui_txt2img_workflow(
        {
            **request_data,
            "model": model,
            "sampler": sampler,
            "scheduler": scheduler,
            "seed": seed,
        }
    )
    client_id = str(uuid.uuid4())
    submit_response = request_json(
        base_url,
        "/prompt",
        method="POST",
        payload={"prompt": workflow, "client_id": client_id},
        timeout=30.0,
    )
    node_errors = submit_response.get("node_errors") if isinstance(submit_response, dict) else None
    if node_errors:
        raise HTTPException(status_code=502, detail={"message": "ComfyUI rejected the workflow", "node_errors": node_errors})
    prompt_id = submit_response.get("prompt_id") if isinstance(submit_response, dict) else None
    if not prompt_id:
        raise HTTPException(status_code=502, detail="ComfyUI did not return a prompt_id")

    history_record = wait_for_comfyui_history(base_url, prompt_id)
    image_refs = _extract_comfyui_image_refs(history_record)
    if not image_refs:
        raise HTTPException(status_code=502, detail={"message": "ComfyUI completed without image outputs", "prompt_id": prompt_id})

    images = [_fetch_comfyui_image_as_data_url(base_url, image_ref) for image_ref in image_refs]
    return {
        "images": images,
        "prompt_id": prompt_id,
        "parameters": {
            "model": model,
            "sampler": sampler,
            "scheduler": scheduler,
            "steps": request_data.get("steps", 30),
            "cfg_scale": request_data.get("cfg_scale", 7.0),
            "seed": seed,
            "width": request_data.get("width", 1024),
            "height": request_data.get("height", 1024),
            "batch_size": _comfyui_batch_size(request_data),
        },
    }


def build_comfyui_txt2img_workflow(request_data: Dict[str, Any]) -> Dict[str, Any]:
    prompt = request_data.get("prompt", "")
    negative_prompt = request_data.get("negative_prompt") or ""
    workflow: Dict[str, Any] = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": request_data["model"]},
        },
    }

    model_ref: List[Any] = ["1", 0]
    clip_ref: List[Any] = ["1", 1]
    next_node_id = 2
    for lora in request_data.get("loras") or []:
        if not isinstance(lora, dict) or lora.get("enabled") is False:
            continue
        name = str(lora.get("name") or "").strip()
        if not name:
            continue
        weight = float(lora.get("weight", 1.0))
        node_id = str(next_node_id)
        workflow[node_id] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": model_ref,
                "clip": clip_ref,
                "lora_name": name,
                "strength_model": weight,
                "strength_clip": weight,
            },
        }
        model_ref = [node_id, 0]
        clip_ref = [node_id, 1]
        next_node_id += 1

    positive_id = str(next_node_id)
    negative_id = str(next_node_id + 1)
    latent_id = str(next_node_id + 2)
    sampler_id = str(next_node_id + 3)
    decode_id = str(next_node_id + 4)
    save_id = str(next_node_id + 5)

    workflow[positive_id] = {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": clip_ref}}
    workflow[negative_id] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative_prompt, "clip": clip_ref}}
    workflow[latent_id] = {
        "class_type": "EmptyLatentImage",
        "inputs": {
            "width": request_data.get("width", 1024),
            "height": request_data.get("height", 1024),
            "batch_size": _comfyui_batch_size(request_data),
        },
    }
    workflow[sampler_id] = {
        "class_type": "KSampler",
        "inputs": {
            "model": model_ref,
            "seed": request_data.get("seed", 0),
            "steps": request_data.get("steps", 30),
            "cfg": request_data.get("cfg_scale", 7.0),
            "sampler_name": request_data.get("sampler") or "euler",
            "scheduler": request_data.get("scheduler") or "normal",
            "positive": [positive_id, 0],
            "negative": [negative_id, 0],
            "latent_image": [latent_id, 0],
            "denoise": 1.0,
        },
    }
    workflow[decode_id] = {"class_type": "VAEDecode", "inputs": {"samples": [sampler_id, 0], "vae": ["1", 2]}}
    workflow[save_id] = {
        "class_type": "SaveImage",
        "inputs": {"images": [decode_id, 0], "filename_prefix": "WildcardStudio"},
    }
    return workflow


def wait_for_comfyui_history(base_url: str, prompt_id: str, timeout: float = 300.0, poll_interval: float = 1.0) -> Dict[str, Any]:
    deadline = time.time() + timeout
    last_status: Dict[str, Any] = {}
    while time.time() < deadline:
        history_payload = request_json(base_url, f"/history/{prompt_id}", timeout=8.0)
        if isinstance(history_payload, dict):
            record = history_payload.get(prompt_id) if isinstance(history_payload.get(prompt_id), dict) else history_payload
            last_status = record if isinstance(record, dict) else {}
            if _extract_comfyui_image_refs(last_status):
                return last_status
            status = last_status.get("status") if isinstance(last_status.get("status"), dict) else {}
            if status.get("status_str") in {"error", "failed"}:
                raise HTTPException(status_code=502, detail={"message": "ComfyUI generation failed", "status": status})
        time.sleep(poll_interval)

    raise HTTPException(status_code=504, detail={"message": "ComfyUI generation timed out", "last_status": last_status})


def save_generation_images(encoded_images: Iterable[str], backups_path: str) -> List[str]:
    target_dir = Path(backups_path) / "generations"
    target_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: List[str] = []
    stamp = time.strftime("%Y%m%d_%H%M%S")

    for index, encoded in enumerate(encoded_images):
        image_bytes, extension = _decode_image(encoded)
        filename = f"generation_{stamp}_{uuid.uuid4().hex}_{index}.{extension}"
        path = target_dir / filename
        path.write_bytes(image_bytes)
        saved_paths.append(str(path))

    return saved_paths


def _docker_host_base_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    hostname = (parsed.hostname or "").lower()
    if hostname not in LOCAL_CONNECTOR_HOSTS or not _running_inside_container():
        return base_url

    auth = ""
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth += f":{parsed.password}"
        auth += "@"
    netloc = f"{auth}{DOCKER_HOST_GATEWAY}"
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


def _running_inside_container() -> bool:
    if os.getenv("WILDCARDSTUDIO_DOCKER") == "1":
        return True
    if os.getenv("container"):
        return True
    if Path("/.dockerenv").exists():
        return True
    cgroup_path = Path("/proc/1/cgroup")
    if not cgroup_path.exists():
        return False
    try:
        content = cgroup_path.read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return False
    return "docker" in content or "containerd" in content


def _try_endpoint(base_url: str, path: str, errors: List[str]) -> Any:
    try:
        return request_json(base_url, path, timeout=2.0)
    except HTTPException as exc:
        errors.append(f"{path}: {exc.detail}")
        return None


def _try_endpoint_list(base_url: str, path: str, errors: List[str]) -> List[str]:
    return _extract_named_items(_try_endpoint(base_url, path, errors))


def _extract_named_items(payload: Any) -> List[str]:
    if not payload:
        return []
    if isinstance(payload, list):
        values: List[str] = []
        for item in payload:
            if isinstance(item, str):
                values.append(item)
            elif isinstance(item, dict):
                value = item.get("name") or item.get("model_name") or item.get("title") or item.get("alias")
                if value:
                    values.append(str(value))
        return sorted(dict.fromkeys(values))
    if isinstance(payload, dict):
        if isinstance(payload.get("models"), list):
            return _extract_named_items(payload["models"])
        if isinstance(payload.get("loras"), list):
            return _extract_named_items(payload["loras"])
    return []


def _extract_comfyui_checkpoint_choices(object_info: Dict[str, Any]) -> List[str]:
    loader_info = object_info.get("CheckpointLoaderSimple") or {}
    required = loader_info.get("input", {}).get("required", {})
    return _extract_choice_list(required.get("ckpt_name"))


def _extract_comfyui_lora_choices(object_info: Dict[str, Any]) -> List[str]:
    lora_info = object_info.get("LoraLoader") or {}
    required = lora_info.get("input", {}).get("required", {})
    return _extract_choice_list(required.get("lora_name"))


def _extract_comfyui_sampler_choices(object_info: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    sampler_info = object_info.get("KSampler") or object_info.get("KSamplerAdvanced") or {}
    inputs = sampler_info.get("input", {})
    required = inputs.get("required", {}) if isinstance(inputs, dict) else {}
    return (
        _extract_choice_list(required.get("sampler_name")),
        _extract_choice_list(required.get("scheduler")),
    )


def _extract_comfyui_defaults(object_info: Dict[str, Any]) -> Dict[str, Any]:
    sampler_info = object_info.get("KSampler") or {}
    latent_info = object_info.get("EmptyLatentImage") or {}
    sampler_required = sampler_info.get("input", {}).get("required", {})
    latent_required = latent_info.get("input", {}).get("required", {})
    return {
        "sampler": _extract_default_choice(
            sampler_required.get("sampler_name"),
            preferred=("euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "heun"),
        ),
        "scheduler": _extract_default_choice(
            sampler_required.get("scheduler"),
            preferred=("normal", "karras", "simple", "sgm_uniform"),
        ),
        "steps": _extract_default_value(sampler_required.get("steps")),
        "cfg_scale": _extract_default_value(sampler_required.get("cfg")),
        "seed": _extract_default_value(sampler_required.get("seed")),
        "width": _extract_default_value(latent_required.get("width")),
        "height": _extract_default_value(latent_required.get("height")),
    }


def _extract_comfyui_node_support(object_info: Dict[str, Any]) -> Dict[str, bool]:
    node_names = [
        "CheckpointLoaderSimple",
        "CLIPTextEncode",
        "EmptyLatentImage",
        "KSampler",
        "VAEDecode",
        "SaveImage",
        "LoraLoader",
    ]
    return {name: name in object_info for name in node_names}


def _supports_basic_comfyui_txt2img(node_support: Dict[str, Any]) -> bool:
    required = ["CheckpointLoaderSimple", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage"]
    return all(bool(node_support.get(name)) for name in required)


def _extract_choice_list(value: Any) -> List[str]:
    if isinstance(value, list) and value and isinstance(value[0], list):
        return sorted(dict.fromkeys(str(item) for item in value[0]))
    return []


def _extract_default_choice(value: Any, preferred: Tuple[str, ...] = ()) -> Optional[str]:
    choices = _extract_choice_list(value)
    if isinstance(value, list) and len(value) > 1 and isinstance(value[1], dict):
        default = value[1].get("default")
        if default is not None:
            return str(default)
    lower_choices = {choice.lower(): choice for choice in choices}
    for candidate in preferred:
        if candidate.lower() in lower_choices:
            return lower_choices[candidate.lower()]
    return choices[0] if choices else None


def _extract_default_value(value: Any) -> Any:
    if isinstance(value, list) and len(value) > 1 and isinstance(value[1], dict):
        return value[1].get("default")
    return None


def _first(values: Any) -> Optional[str]:
    if isinstance(values, list) and values:
        return values[0]
    return None


def _preferred_model(values: Any) -> Optional[str]:
    if not isinstance(values, list) or not values:
        return None
    models = [str(value) for value in values if value]
    if not models:
        return None

    blocked = ("auraflow", "flux")
    preferred = ("sd_xl_base", "sdxl", "sd_xl", "illustrious", "noobai", "pony")
    for needle in preferred:
        for model in models:
            normalized = model.lower().replace("-", "_").replace(" ", "_")
            if needle in normalized and not any(item in normalized for item in blocked):
                return model
    for model in models:
        normalized = model.lower().replace("-", "_").replace(" ", "_")
        if not any(item in normalized for item in blocked):
            return model
    return models[0]


def _prompt_with_loras(prompt: str, loras: List[Dict[str, Any]]) -> str:
    tokens = []
    for lora in loras:
        if not isinstance(lora, dict) or lora.get("enabled") is False:
            continue
        name = str(lora.get("name") or "").strip()
        if not name:
            continue
        weight = lora.get("weight", 1.0)
        token = f"<lora:{name}:{weight}>"
        if token not in prompt:
            tokens.append(token)
    return " ".join([part for part in [prompt.strip(), " ".join(tokens)] if part])


def _decode_image(encoded: str) -> Tuple[bytes, str]:
    if "," in encoded and encoded.lower().startswith("data:"):
        header, encoded = encoded.split(",", 1)
        extension = "jpg" if "jpeg" in header.lower() else "png"
    else:
        extension = "png"
    return base64.b64decode(encoded), extension


def _normalize_seed(value: Any) -> int:
    try:
        seed = int(value)
    except (TypeError, ValueError):
        seed = -1
    if seed < 0:
        return random.randint(0, 2**63 - 1)
    return seed


def _comfyui_batch_size(request_data: Dict[str, Any]) -> int:
    batch_size = _bounded_int(request_data.get("batch_size", 1), minimum=1, maximum=16)
    batch_count = _bounded_int(request_data.get("batch_count", 1), minimum=1, maximum=16)
    return min(batch_size * batch_count, 64)


def _bounded_int(value: Any, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = minimum
    return max(minimum, min(maximum, parsed))


def _extract_comfyui_image_refs(history_record: Dict[str, Any]) -> List[Dict[str, Any]]:
    outputs = history_record.get("outputs") if isinstance(history_record, dict) else None
    if not isinstance(outputs, dict):
        return []
    refs: List[Dict[str, Any]] = []
    for output in outputs.values():
        if not isinstance(output, dict):
            continue
        for image in output.get("images") or []:
            if isinstance(image, dict) and image.get("filename"):
                refs.append(
                    {
                        "filename": image["filename"],
                        "subfolder": image.get("subfolder", ""),
                        "type": image.get("type", "output"),
                    }
                )
    return refs


def _fetch_comfyui_image_as_data_url(base_url: str, image_ref: Dict[str, Any]) -> str:
    image_bytes = request_bytes(base_url, "/view", params=image_ref, timeout=60.0)
    filename = str(image_ref.get("filename") or "")
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    mime_type = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(extension, "image/png")
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"
