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


def parse_file(path: str) -> Tuple[str, List[Tuple[int, str, float, Optional[str]]]]:
    """
    Parse a wildcard file.
    Returns (format, [(line_number, content, weight, wildcard_path), ...])
    """
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except Exception:
        return "impact", []

    from config import get_settings
    settings = get_settings()
    try:
        rel_path = os.path.relpath(path, settings.wildcards_path).replace("\\", "/")
    except Exception:
        rel_path = os.path.basename(path).replace("\\", "/")
    base_path = os.path.splitext(rel_path)[0]

    fmt = detect_format(path, raw)

    if path.endswith(".txt"):
        entries = [(line, text, weight, base_path) for line, text, weight in _parse_txt(raw)]
    else:
        entries = _parse_yaml(raw, fmt, base_path)

    return fmt, entries


def _parse_txt(content: str) -> List[Tuple[int, str, float]]:
    """Parse flat text file — one entry per line."""
    entries = []
    for i, line in enumerate(content.splitlines(), start=1):
        line = line.strip()
        if line and not line.startswith("#"):
            text, weight = _extract_weight(line)
            entries.append((i, text, weight))
    return entries


def _parse_yaml(content: str, fmt: str, base_path: str) -> List[Tuple[int, str, float, Optional[str]]]:
    """Parse YAML file in impact or dynamic-prompts format recursively."""
    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError:
        return [(line, text, weight, base_path) for line, text, weight in _parse_txt(content)]

    entries = []

    if data is None:
        return entries

    def walk(node, current_path: List[str], line_counter: List[int]):
        if isinstance(node, list):
            path_str = "/".join(current_path) if current_path else base_path
            if current_path and not path_str.startswith(base_path + "/"):
                path_str = f"{base_path}/{path_str}"
            for item in node:
                if item is not None:
                    text, weight = _extract_weight(str(item))
                    entries.append((line_counter[0], text, weight, path_str))
                    line_counter[0] += 1
        elif isinstance(node, dict):
            for key, value in node.items():
                walk(value, current_path + [str(key)], line_counter)
        elif isinstance(node, (str, int, float, bool)):
            path_str = "/".join(current_path) if current_path else base_path
            if current_path and not path_str.startswith(base_path + "/"):
                path_str = f"{base_path}/{path_str}"
            text, weight = _extract_weight(str(node))
            entries.append((line_counter[0], text, weight, path_str))
            line_counter[0] += 1

    line_counter = [1]
    if isinstance(data, list):
        walk(data, [], line_counter)
    elif isinstance(data, dict):
        for key, value in data.items():
            walk(value, [str(key)], line_counter)

    return entries


def _extract_weight(text: str) -> Tuple[str, float]:
    """Extract weight from Dynamic-Prompts/Impact syntax like '::1.5::content', '1.5::content' or plain text."""
    text_stripped = text.strip()
    # 1. Match ::N.N::text
    m1 = re.match(r"^::(\d+(?:\.\d+)?)::(.*)", text_stripped)
    if m1:
        return m1.group(2).strip(), float(m1.group(1))
    # 2. Match N.N::text or N::text
    m2 = re.match(r"^(\d+(?:\.\d+)?)::(.*)", text_stripped)
    if m2:
        return m2.group(2).strip(), float(m2.group(1))
    return text_stripped, 1.0


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
