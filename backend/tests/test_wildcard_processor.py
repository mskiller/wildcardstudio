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

def test_resolve_braces_range_with_zero():
    # Test range that can evaluate to 0, e.g. {0-1$$a}
    # Since it's random, we can run it multiple times to cover both 0 and 1
    results = set()
    for _ in range(20):
        res = resolve_braces("{0-1$$a}")
        results.add(res)
    assert "" in results
    assert "a" in results
    assert len(results) == 2

def test_resolve_braces_range_selection():
    # Test range selection like {1-3$$a|b|c}
    # Since random.sample is used, the order and choice will vary, but count should be between 1 and 3
    for _ in range(50):
        res = resolve_braces("{1-3$$a|b|c}")
        parts = [p.strip() for p in res.split(",") if p.strip()]
        assert 1 <= len(parts) <= 3
        for part in parts:
            assert part in {"a", "b", "c"}
        # Ensure no duplicates in the sample
        assert len(parts) == len(set(parts))

def test_resolve_braces_zero_count():
    # Test specific 0 count brace selection like {0$$a|b}
    res = resolve_braces("{0$$a|b}")
    assert res == ""

def test_resolve_braces_weights():
    # Verify option with weights e.g. {10::red|0::blue} chooses red significantly more often than blue
    # and verify the weight prefix is stripped
    results = [resolve_braces("{10::red|0::blue}") for _ in range(100)]
    assert "red" in results
    assert "blue" not in results
    for r in results:
        assert r == "red"

    # Check mixed: one with weight prefix and one without (should default to 1.0)
    results_mixed = [resolve_braces("{10::red|blue}") for _ in range(100)]
    red_count = results_mixed.count("red")
    blue_count = results_mixed.count("blue")
    assert red_count > blue_count
    for r in results_mixed:
        assert r in ("red", "blue")

def test_resolve_braces_complex_delimiter():
    # Verify {2$$ and $$red|red} resolves to "red and red"
    res1 = resolve_braces("{2$$ and $$red|red}")
    assert res1 == "red and red"
    
    # Verify {2$$ and $$red|blue|yellow} resolves to combinations like "blue and yellow", "red and blue", etc.
    possible = {
        "red and blue", "red and yellow", "blue and red", "blue and yellow", "yellow and red", "yellow and blue"
    }
    for _ in range(50):
        res2 = resolve_braces("{2$$ and $$red|blue|yellow}")
        assert res2 in possible

