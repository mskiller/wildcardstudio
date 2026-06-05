from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from database import get_session
from models.wildcard import WildcardFile, WildcardEntry
from routers import generator as generator_router
from fastapi import FastAPI

def test_process_prompt_endpoint(tmp_path: Path):
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
