import base64
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from database import get_session
from routers import generation as generation_router
from services import generation_connector


def build_client(tmp_path: Path) -> TestClient:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    backups_dir = tmp_path / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    generation_router.settings.backups_path = str(backups_dir)

    def override_session():
        with Session(engine) as session:
            yield session

    app = FastAPI()
    app.dependency_overrides[get_session] = override_session
    app.include_router(generation_router.router, prefix="/generation")
    return TestClient(app)


def test_capabilities_are_discovered(monkeypatch, tmp_path: Path):
    client = build_client(tmp_path)

    def fake_discover(provider, base_url):
        return {
            "provider": provider,
            "base_url": base_url,
            "reachable": True,
            "models": ["demo.safetensors"],
            "loras": ["detailer"],
            "samplers": ["Euler"],
            "schedulers": ["Automatic"],
            "options": {},
            "errors": [],
        }

    monkeypatch.setattr(generation_router.generation_connector, "discover_capabilities", fake_discover)

    resp = client.get(
        "/generation/capabilities",
        params={"provider": "sdforge", "base_url": "http://forge.local"},
    )

    assert resp.status_code == 200
    assert resp.json()["models"] == ["demo.safetensors"]
    assert resp.json()["samplers"] == ["Euler"]


def test_sdforge_txt2img_persists_history_and_image(monkeypatch, tmp_path: Path):
    client = build_client(tmp_path)
    encoded = base64.b64encode(b"fake png bytes").decode("ascii")

    def fake_txt2img(request_data):
        assert request_data["provider"] == "sdforge"
        assert request_data["base_url"] == "http://forge.local"
        return {"images": [encoded], "parameters": {"steps": 12}, "info": "{}"}

    monkeypatch.setattr(generation_router.generation_connector, "sdforge_txt2img", fake_txt2img)

    resp = client.post(
        "/generation/txt2img",
        json={
            "provider": "sdforge",
            "base_url": "http://forge.local",
            "prompt": "a test prompt",
            "negative_prompt": "blur",
            "model": "demo.safetensors",
            "sampler": "Euler",
            "scheduler": "Automatic",
            "steps": 12,
            "cfg_scale": 6.5,
            "seed": 42,
            "width": 1024,
            "height": 1024,
            "loras": [{"name": "detailer", "weight": 0.8}],
        },
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["image_count"] == 1
    assert payload["id"]

    history_resp = client.get("/generation/history")
    assert history_resp.status_code == 200
    history = history_resp.json()["items"]
    assert len(history) == 1
    assert history[0]["prompt"] == "a test prompt"
    assert history[0]["image_count"] == 1
    assert history[0]["status"] == "completed"

    image_resp = client.get(f"/generation/history/{payload['id']}/image")
    assert image_resp.status_code == 200
    assert image_resp.content == b"fake png bytes"
    assert image_resp.headers["content-type"] == "image/png"


def test_comfyui_capabilities_rewrite_localhost_from_container(monkeypatch, tmp_path: Path):
    client = build_client(tmp_path)

    monkeypatch.setattr(generation_connector, "_running_inside_container", lambda: True)

    def fake_request_json(base_url, path, *, method="GET", payload=None, timeout=8.0):
        assert base_url == "http://host.docker.internal:8188"
        if path == "/models/checkpoints":
            return ["comfy.safetensors"]
        if path == "/models/loras":
            return ["detailer.safetensors"]
        if path == "/object_info":
            return minimal_comfyui_object_info()
        raise AssertionError(f"unexpected path {path}")

    monkeypatch.setattr(generation_connector, "request_json", fake_request_json)

    resp = client.get(
        "/generation/capabilities",
        params={"provider": "comfyui", "base_url": "http://127.0.0.1:8188"},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["base_url"] == "http://127.0.0.1:8188"
    assert payload["effective_base_url"] == "http://host.docker.internal:8188"
    assert payload["models"] == ["comfy.safetensors"]
    assert payload["loras"] == ["detailer.safetensors"]
    assert payload["samplers"] == ["euler"]
    assert payload["schedulers"] == ["normal"]
    assert payload["supports_txt2img"] is True
    assert "KSampler" not in payload["options"]


def test_comfyui_capabilities_expose_basic_workflow_defaults(monkeypatch, tmp_path: Path):
    client = build_client(tmp_path)

    monkeypatch.setattr(generation_connector, "_running_inside_container", lambda: True)

    def fake_request_json(base_url, path, *, method="GET", payload=None, timeout=8.0):
        if path == "/models/checkpoints":
            return ["Auraflow\\pony-v7-base.safetensors", "sd_xl_base_1.0.safetensors"]
        if path == "/models/loras":
            return []
        if path == "/object_info":
            return minimal_comfyui_object_info()
        raise AssertionError(f"unexpected path {path}")

    monkeypatch.setattr(generation_connector, "request_json", fake_request_json)

    resp = client.get(
        "/generation/capabilities",
        params={"provider": "comfyui", "base_url": "http://127.0.0.1:8188"},
    )

    assert resp.status_code == 200
    defaults = resp.json()["defaults"]
    assert defaults["model"] == "sd_xl_base_1.0.safetensors"
    assert defaults["sampler"] == "euler"
    assert defaults["scheduler"] == "normal"


def test_comfyui_connector_submits_workflow_and_fetches_real_image(monkeypatch):
    calls = []
    encoded_image_bytes = b"real png bytes"

    monkeypatch.setattr(generation_connector, "_running_inside_container", lambda: True)

    def fake_request_json(base_url, path, *, method="GET", payload=None, timeout=8.0):
        calls.append((base_url, path, method, payload))
        assert base_url == "http://host.docker.internal:8188"
        if path == "/models/checkpoints":
            return ["comfy.safetensors"]
        if path == "/models/loras":
            return ["detailer.safetensors"]
        if path == "/object_info":
            return minimal_comfyui_object_info()
        if path == "/prompt":
            workflow = payload["prompt"]
            assert method == "POST"
            assert workflow["1"]["inputs"]["ckpt_name"] == "comfy.safetensors"
            assert workflow["2"]["class_type"] == "LoraLoader"
            assert workflow["6"]["inputs"]["sampler_name"] == "euler"
            assert workflow["6"]["inputs"]["scheduler"] == "normal"
            return {"prompt_id": "abc123", "node_errors": {}}
        if path == "/history/abc123":
            return {
                "abc123": {
                    "outputs": {
                        "8": {
                            "images": [
                                {"filename": "WildcardStudio_00001_.png", "subfolder": "", "type": "output"}
                            ]
                        }
                    }
                }
            }
        raise AssertionError(f"unexpected path {path}")

    def fake_request_bytes(base_url, path, *, params=None, timeout=30.0):
        assert base_url == "http://host.docker.internal:8188"
        assert path == "/view"
        assert params["filename"] == "WildcardStudio_00001_.png"
        return encoded_image_bytes

    monkeypatch.setattr(generation_connector, "request_json", fake_request_json)
    monkeypatch.setattr(generation_connector, "request_bytes", fake_request_bytes)

    result = generation_connector.comfyui_txt2img(
        {
            "provider": "comfyui",
            "base_url": "http://127.0.0.1:8188",
            "prompt": "a test prompt",
            "negative_prompt": "blur",
            "model": "comfy.safetensors",
            "sampler": "euler",
            "scheduler": "normal",
            "steps": 4,
            "cfg_scale": 5.5,
            "seed": 123,
            "width": 512,
            "height": 512,
            "batch_size": 1,
            "batch_count": 1,
            "loras": [{"name": "detailer.safetensors", "weight": 0.8, "enabled": True}],
        }
    )

    assert result["prompt_id"] == "abc123"
    assert result["images"] == [f"data:image/png;base64,{base64.b64encode(encoded_image_bytes).decode('ascii')}"]
    assert result["parameters"]["seed"] == 123
    assert any(path == "/prompt" for _, path, _, _ in calls)


def test_comfyui_txt2img_persists_history_and_image(monkeypatch, tmp_path: Path):
    client = build_client(tmp_path)
    encoded = base64.b64encode(b"fake comfy png bytes").decode("ascii")

    def fake_txt2img(request_data):
        assert request_data["provider"] == "comfyui"
        assert request_data["base_url"] == "http://comfy.local"
        return {"images": [encoded], "prompt_id": "abc123", "parameters": {"steps": 5}}

    monkeypatch.setattr(generation_router.generation_connector, "comfyui_txt2img", fake_txt2img)

    resp = client.post(
        "/generation/txt2img",
        json={
            "provider": "comfyui",
            "base_url": "http://comfy.local",
            "prompt": "a test prompt",
            "steps": 5,
            "batch_size": 1,
            "batch_count": 1,
        },
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["provider"] == "comfyui"
    assert payload["image_count"] == 1

    history_resp = client.get("/generation/history")
    assert history_resp.status_code == 200
    history = history_resp.json()["items"]
    assert history[0]["provider"] == "comfyui"
    assert history[0]["status"] == "completed"
    assert history[0]["image_count"] == 1


def minimal_comfyui_object_info():
    return {
        "CheckpointLoaderSimple": {
            "input": {"required": {"ckpt_name": [["comfy.safetensors"], {"default": "comfy.safetensors"}]}}
        },
        "LoraLoader": {
            "input": {"required": {"lora_name": [["detailer.safetensors"], {"default": "detailer.safetensors"}]}}
        },
        "CLIPTextEncode": {"input": {"required": {"text": ["STRING", {}], "clip": ["CLIP", {}]}}},
        "EmptyLatentImage": {
            "input": {
                "required": {
                    "width": ["INT", {"default": 1024}],
                    "height": ["INT", {"default": 1024}],
                    "batch_size": ["INT", {"default": 1}],
                }
            }
        },
        "KSampler": {
            "input": {
                "required": {
                    "sampler_name": [["euler"], {"default": "euler"}],
                    "scheduler": [["normal"], {"default": "normal"}],
                    "steps": ["INT", {"default": 20}],
                    "cfg": ["FLOAT", {"default": 7.0}],
                    "seed": ["INT", {"default": 0}],
                }
            }
        },
        "VAEDecode": {"input": {"required": {"samples": ["LATENT", {}], "vae": ["VAE", {}]}}},
        "SaveImage": {"input": {"required": {"images": ["IMAGE", {}], "filename_prefix": ["STRING", {}]}}},
    }
