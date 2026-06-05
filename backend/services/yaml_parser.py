"""
Parsing service for wildcard files.
Supports:
  - Impact (ComfyUI): flat .txt or .yaml lists
  - Dynamic-Prompts (SD-Forge): hierarchical .yaml with __name__ keys
"""
import yaml
import os
import re
from typing import List, Tuple, Optional


def detect_format(path: str, content: str) -> str:
    """Returns 'impact' or 'dynamic_prompts'."""
    if path.endswith(".txt"):
        return "impact"
    # Check for __name__: pattern in YAML keys
    if re.search(r"^__\w+__\s*:", content, re.MULTILINE):
        return "dynamic_prompts"
    return "impact"


def parse_file(path: str) -> Tuple[str, List[Tuple[int, str, float]]]:
    """
    Parse a wildcard file.
    Returns (format, [(line_number, content, weight), ...])
    """
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except Exception:
        return "impact", []

    fmt = detect_format(path, raw)

    if path.endswith(".txt"):
        entries = _parse_txt(raw)
    else:
        entries = _parse_yaml(raw, fmt)

    return fmt, entries


def _parse_txt(content: str) -> List[Tuple[int, str, float]]:
    """Parse flat text file — one entry per line."""
    entries = []
    for i, line in enumerate(content.splitlines(), start=1):
        line = line.strip()
        if line and not line.startswith("#"):
            entries.append((i, line, 1.0))
    return entries


def _parse_yaml(content: str, fmt: str) -> List[Tuple[int, str, float]]:
    """Parse YAML file in impact or dynamic-prompts format."""
    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError:
        return _parse_txt(content)

    entries = []

    if data is None:
        return entries

    if isinstance(data, list):
        # Simple flat list — Impact format
        for i, item in enumerate(data, start=1):
            if item is not None:
                text, weight = _extract_weight(str(item))
                entries.append((i, text, weight))
    elif isinstance(data, dict):
        # Dynamic-Prompts: keys may be __wildcard_name__ or plain category names
        line = 1
        for key, value in data.items():
            if isinstance(value, list):
                for item in value:
                    if item is not None:
                        text, weight = _extract_weight(str(item))
                        entries.append((line, text, weight))
                        line += 1
            elif isinstance(value, str):
                text, weight = _extract_weight(value)
                entries.append((line, text, weight))
                line += 1

    return entries


def _extract_weight(text: str) -> Tuple[str, float]:
    """Extract weight from Dynamic-Prompts syntax like '::1.5::content' or plain text."""
    # Dynamic-Prompts weight prefix: ::N.N::text
    m = re.match(r"^::(\d+(?:\.\d+)?)::(.*)", text.strip())
    if m:
        return m.group(2).strip(), float(m.group(1))
    return text.strip(), 1.0


def render_preview(entries: List[Tuple[int, str, float]], n: int = 5) -> List[str]:
    """Return n random samples from entries."""
    import random
    if not entries:
        return []
    # Weighted random selection
    weights = [e[2] for e in entries]
    total = sum(weights)
    if total == 0:
        weights = [1.0] * len(entries)
    k = min(n, len(entries))
    chosen = random.choices(entries, weights=weights, k=k)
    return [e[1] for e in chosen]
