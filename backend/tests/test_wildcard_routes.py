import json
import base64
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool
from fastapi import FastAPI

from database import get_session
from models.wildcard import WildcardFile, WildcardEntry
from models.prompt import GenerationHistory
from routers import generator as generator_router

def test_process_prompt_endpoint():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    
    def override_session():
        with Session(engine) as session:
            yield session
            
    app = FastAPI()
    app.dependency_overrides[get_session] = override_session
    app.include_router(generator_router.router, prefix="/generator")
    client = TestClient(app)
    
    # Seed
    with Session(engine) as session:
        wf = WildcardFile(path="outfits.txt", filename="outfits.txt", format="impact", entry_count=1)
        session.add(wf)
        session.flush()
        session.add(WildcardEntry(file_id=wf.id, content="maid uniform", weight=1.0))
        session.commit()
        
    resp = client.post("/generator/process-prompt", json={"prompt": "wearing a __outfits__", "count": 2})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["processed"] == ["wearing a maid uniform", "wearing a maid uniform"]


def test_txt2img_resolves_wildcards(monkeypatch, tmp_path: Path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    
    from routers import generation as generation_router
    
    backups_dir = tmp_path / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    generation_router.settings.backups_path = str(backups_dir)
    
    def override_session():
        with Session(engine) as session:
            yield session
            
    app = FastAPI()
    app.dependency_overrides[get_session] = override_session
    app.include_router(generation_router.router, prefix="/generation")
    client = TestClient(app)
    
    # Seed wildcards in DB
    with Session(engine) as session:
        wf1 = WildcardFile(path="outfits.txt", filename="outfits.txt", format="impact", entry_count=1)
        session.add(wf1)
        session.flush()
        session.add(WildcardEntry(file_id=wf1.id, content="maid uniform", weight=1.0))
        
        wf2 = WildcardFile(path="bad_things.txt", filename="bad_things.txt", format="impact", entry_count=1)
        session.add(wf2)
        session.flush()
        session.add(WildcardEntry(file_id=wf2.id, content="bad quality", weight=1.0))
        
        session.commit()
        
    # Mock generation connector
    encoded = base64.b64encode(b"fake png bytes").decode("ascii")
    
    called_payloads = []
    
    def fake_sdforge_txt2img(request_data):
        called_payloads.append(request_data)
        return {"images": [encoded], "parameters": {"steps": 12}, "info": "{}"}
        
    monkeypatch.setattr(generation_router.generation_connector, "sdforge_txt2img", fake_sdforge_txt2img)
    
    # Request with wildcards in both prompt and negative_prompt
    resp = client.post(
        "/generation/txt2img",
        json={
            "provider": "sdforge",
            "base_url": "http://forge.local",
            "prompt": "wearing a __outfits__",
            "negative_prompt": "avoid __bad_things__",
            "steps": 12,
        }
    )
    
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["image_count"] == 1
    
    # Verify that the resolved prompts were passed to the connector
    assert len(called_payloads) == 1
    assert called_payloads[0]["prompt"] == "wearing a maid uniform"
    assert called_payloads[0]["negative_prompt"] == "avoid bad quality"
    
    # Verify saved history in DB
    with Session(engine) as session:
        record = session.exec(select(GenerationHistory)).one()
        assert record.prompt == "wearing a __outfits__"
        assert record.negative_prompt == "avoid __bad_things__"
        
        meta = json.loads(record.metadata_json)
        assert meta["processed_prompt"] == "wearing a maid uniform"
        assert meta["processed_negative_prompt"] == "avoid bad quality"
