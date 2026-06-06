"""Tests for the YAML/TXT parser."""
import pytest
import tempfile
import os
from services.yaml_parser import parse_file, detect_format, render_preview


def write_tmp(content: str, suffix: str = ".yaml") -> str:
    from config import get_settings
    settings = get_settings()
    os.makedirs(settings.wildcards_path, exist_ok=True)
    f = tempfile.NamedTemporaryFile(mode="w", suffix=suffix, dir=settings.wildcards_path, delete=False, encoding="utf-8")
    f.write(content)
    f.close()
    return f.name


def test_flat_yaml_impact():
    path = write_tmp("- cinematic lighting\n- soft bokeh\n- golden hour\n")
    fmt, entries = parse_file(path)
    assert fmt == "impact"
    assert len(entries) == 3
    assert entries[0][1] == "cinematic lighting"
    os.unlink(path)


def test_dynamic_prompts_yaml():
    content = "__lighting__:\n  - dramatic side lighting\n  - soft diffused light\n"
    path = write_tmp(content)
    fmt, entries = parse_file(path)
    assert fmt == "dynamic_prompts"
    assert len(entries) == 2
    os.unlink(path)


def test_txt_file():
    path = write_tmp("one entry\nanother entry\n# comment\n", suffix=".txt")
    fmt, entries = parse_file(path)
    assert fmt == "impact"
    assert len(entries) == 2
    assert entries[0][1] == "one entry"
    os.unlink(path)


def test_empty_file():
    path = write_tmp("")
    fmt, entries = parse_file(path)
    assert entries == []
    os.unlink(path)


def test_render_preview():
    entries = [(1, "a", 1.0), (2, "b", 1.0), (3, "c", 1.0)]
    samples = render_preview(entries, n=2)
    assert len(samples) == 2
    assert all(s in ["a", "b", "c"] for s in samples)


def test_hierarchical_yaml_parser():
    content = """
Bo:
  random:
    anything:
      - dramatic side lighting
      - soft diffused light
"""
    path = write_tmp(content)
    fmt, entries = parse_file(path)
    base_name = os.path.splitext(os.path.basename(path))[0]
    assert len(entries) == 2
    assert entries[0][3] == f"{base_name}/Bo/random/anything"
    os.unlink(path)
