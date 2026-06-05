import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from models.wildcard import WildcardFile, WildcardEntry
from services.wildcard_processor import process_prompt, resolve_braces

@pytest.fixture(name="session")
def session_fixture():
    # Set up in-memory SQLite database
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session

def test_resolve_braces_simple():
    res = resolve_braces("A {red|red} cat")
    assert res == "A red cat"

def test_resolve_braces_range():
    res = resolve_braces("{2$$red|red}")
    assert res == "red, red"

def test_resolve_braces_nested():
    # Test nested braces where inner braces are resolved first
    res = resolve_braces("{A {red|red} cat|A {red|red} cat}")
    assert res == "A red cat"

def test_process_prompt_with_db(session: Session):
    wf = WildcardFile(path="colors.yaml", filename="colors.yaml", format="impact", entry_count=2)
    session.add(wf)
    session.flush()
    
    session.add(WildcardEntry(file_id=wf.id, content="blue", weight=1.0))
    session.add(WildcardEntry(file_id=wf.id, content="green", weight=0.0))
    session.commit()
    
    res = process_prompt(session, "A __colors__ shirt")
    assert res == "A blue shirt"

def test_process_prompt_recursive(session: Session):
    # Test recursive resolution (wildcard resolves to another wildcard)
    wf1 = WildcardFile(path="colors.yaml", filename="colors.yaml", format="impact", entry_count=1)
    session.add(wf1)
    session.flush()
    session.add(WildcardEntry(file_id=wf1.id, content="a __shades__ shirt", weight=1.0))
    
    wf2 = WildcardFile(path="shades.yaml", filename="shades.yaml", format="impact", entry_count=1)
    session.add(wf2)
    session.flush()
    session.add(WildcardEntry(file_id=wf2.id, content="dark", weight=1.0))
    session.commit()
    
    res = process_prompt(session, "A __colors__")
    assert res == "A a dark shirt"

def test_resolve_wildcard_path_matching(session: Session):
    # Test different matching rules: exact path, filename, partial path
    wf1 = WildcardFile(path="nested/dir/colors.yaml", filename="colors.yaml", format="impact", entry_count=1)
    session.add(wf1)
    session.flush()
    session.add(WildcardEntry(file_id=wf1.id, content="matched", weight=1.0))
    session.commit()
    
    # 1. Exact path without extension: nested/dir/colors
    assert process_prompt(session, "__nested/dir/colors__") == "matched"
    
    # 2. Filename without extension: colors
    assert process_prompt(session, "__colors__") == "matched"
    
    # 3. Partial path match: dir/colors
    assert process_prompt(session, "__dir/colors__") == "matched"
    
    # 4. Unknown wildcard: keep reference
    assert process_prompt(session, "__unknown_wildcard__") == "__unknown_wildcard__"
