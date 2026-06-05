"""Tests for the NL/TAG style detector."""
import pytest
from services.nl_detector import detect_style, classify_entries


def test_tag_style():
    text = "masterpiece, best quality, 1girl, solo, smile, school uniform, white background"
    style, ts, nls = detect_style(text)
    assert style == "tag"
    assert ts > nls


def test_nl_style():
    text = "A beautiful woman with long hair standing in a golden wheat field at sunset."
    style, ts, nls = detect_style(text)
    assert style == "nl"
    assert nls > ts


def test_weighted_tag():
    text = "(masterpiece:1.4), (best quality:1.2), 1girl, long hair"
    style, ts, nls = detect_style(text)
    assert style == "tag"


def test_empty_text():
    style, ts, nls = detect_style("")
    assert style == "unknown"
    assert ts == 0
    assert nls == 0


def test_classify_entries_tag():
    entries = [
        "masterpiece, best quality, 1girl",
        "cinematic lighting, bokeh",
        "school uniform, smile",
    ]
    result = classify_entries(entries)
    assert result == "tag"


def test_classify_entries_nl():
    entries = [
        "A woman standing in a field of flowers.",
        "The sun is setting over the horizon.",
        "A child playing with a red ball in the park.",
    ]
    result = classify_entries(entries)
    assert result == "nl"
