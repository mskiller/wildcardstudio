"""Tests for fuzzy duplicate detector."""
from services.fuzzy_matcher import find_duplicates, normalize


def test_normalize():
    assert normalize("(cinematic:1.2)") == "cinematic"
    assert normalize("  Hello   World  ") == "hello world"


def test_exact_duplicates():
    entries = [
        {"id": 1, "file": "a.yaml", "content": "cinematic lighting"},
        {"id": 2, "file": "b.yaml", "content": "cinematic lighting"},
        {"id": 3, "file": "c.yaml", "content": "golden hour"},
    ]
    groups = find_duplicates(entries, threshold=85)
    assert len(groups) == 1
    assert groups[0].type == "exact"
    assert len(groups[0].members) == 2


def test_fuzzy_duplicates():
    entries = [
        {"id": 1, "file": "a.yaml", "content": "cinematic lighting, dramatic shadows"},
        {"id": 2, "file": "b.yaml", "content": "cinematic light, dramatic shadow"},
        {"id": 3, "file": "c.yaml", "content": "completely different content here"},
    ]
    groups = find_duplicates(entries, threshold=80)
    # Should find the two similar ones
    fuzzy_groups = [g for g in groups if g.type == "fuzzy"]
    assert len(fuzzy_groups) >= 1


def test_no_duplicates():
    entries = [
        {"id": 1, "file": "a.yaml", "content": "masterpiece, best quality"},
        {"id": 2, "file": "b.yaml", "content": "simple background, outdoors"},
        {"id": 3, "file": "c.yaml", "content": "1girl, solo, smile"},
    ]
    groups = find_duplicates(entries, threshold=85)
    assert len(groups) == 0


def test_empty_entries():
    groups = find_duplicates([], threshold=85)
    assert groups == []
