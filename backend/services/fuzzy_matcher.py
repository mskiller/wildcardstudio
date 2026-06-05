"""
Two-pass duplicate detection:
  Pass 1 — exact duplicates via MD5 hash of normalized text
  Pass 2 — fuzzy duplicates via rapidfuzz token_sort_ratio
"""
import hashlib
import re
from difflib import SequenceMatcher
from collections import Counter, defaultdict
from typing import Dict, List
from dataclasses import dataclass, field

try:
    from rapidfuzz import fuzz
except ImportError:
    class _FallbackFuzz:
        @staticmethod
        def token_sort_ratio(left: str, right: str) -> float:
            left_sorted = " ".join(sorted(left.split()))
            right_sorted = " ".join(sorted(right.split()))
            return SequenceMatcher(None, left_sorted, right_sorted).ratio() * 100

    fuzz = _FallbackFuzz()


@dataclass
class DuplicateMatch:
    entry_id: int
    file_path: str
    content: str
    similarity: float


@dataclass
class DuplicateGroup:
    group_id: int
    type: str   # 'exact' | 'fuzzy'
    members: List[DuplicateMatch] = field(default_factory=list)


def normalize(text: str) -> str:
    """Normalize text for comparison: lowercase, strip weights, normalize whitespace."""
    # Remove (tag:1.x) weights
    text = re.sub(r"\(([^)]+):\d+(?:\.\d+)?\)", r"\1", text)
    text = text.lower().strip()
    text = re.sub(r"\s+", " ", text)
    return text


def comparison_tokens(text: str) -> list[str]:
    """Return coarse tokens used to block fuzzy comparisons.

    The duplicate scanner can see tens of thousands of entries. Comparing every
    pair is too expensive, so fuzzy matching first builds candidate pairs from
    uncommon shared tokens. This keeps obvious near-duplicates together while
    avoiding huge buckets like "1girl" or "solo".
    """
    tokens = re.findall(r"[a-z0-9][a-z0-9_-]*", text)
    cleaned = []
    for token in tokens:
        if len(token) < 3:
            continue
        token = re.sub(r"(ing|ed|es|s)$", "", token)
        if token and token not in cleaned:
            cleaned.append(token)
    return cleaned


def md5_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def find_duplicates(
    entries: List[Dict],   # [{"id": int, "file": str, "content": str}]
    threshold: int = 85,
) -> List[DuplicateGroup]:
    """
    Find duplicate entries.
    entries: list of dicts with keys id, file, content
    threshold: fuzzy similarity threshold (0–100)
    """
    groups: List[DuplicateGroup] = []
    group_counter = 0
    used_ids = set()
    prepared = [
        {
            **entry,
            "normalized": normalize(entry["content"]),
            "tokens": [],
            "token_count": 0,
        }
        for entry in entries
        if entry.get("id") is not None and entry.get("content")
    ]

    # Pass 1: exact duplicates
    hash_map: Dict[str, List[Dict]] = {}
    for entry in prepared:
        h = md5_hash(entry["normalized"])
        hash_map.setdefault(h, []).append(entry)

    for h, dupes in hash_map.items():
        if len(dupes) > 1:
            group_counter += 1
            members = [
                DuplicateMatch(
                    entry_id=e["id"],
                    file_path=e["file"],
                    content=e["content"],
                    similarity=1.0,
                )
                for e in dupes
            ]
            groups.append(DuplicateGroup(group_id=group_counter, type="exact", members=members))
            for e in dupes:
                used_ids.add(e["id"])

    # Pass 2: fuzzy duplicates on plausible candidates only.
    remaining = [e for e in prepared if e["id"] not in used_ids]
    for entry in remaining:
        entry["tokens"] = comparison_tokens(entry["normalized"])
        entry["token_count"] = max(1, len(entry["normalized"].split()))

    token_frequency = Counter(
        token
        for entry in remaining
        for token in set(entry["tokens"])
    )
    max_bucket_size = max(50, min(2_000, max(1, len(remaining) // 5)))
    token_index: dict[str, list[Dict]] = defaultdict(list)
    for entry in remaining:
        for token in _blocking_tokens(entry, token_frequency, max_bucket_size):
            token_index[token].append(entry)

    fuzzy_group_by_entry: dict[int, DuplicateGroup] = {}
    processed_pairs = set()
    for i, a in enumerate(remaining):
        candidates = _candidate_entries(a, token_index, token_frequency, max_bucket_size)
        for b in candidates:
            if a["id"] == b["id"]:
                continue
            pair = (min(a["id"], b["id"]), max(a["id"], b["id"]))
            if pair in processed_pairs:
                continue
            processed_pairs.add(pair)

            # Optimization: skip entries with very different lengths
            len_a = a["token_count"]
            len_b = b["token_count"]
            if len_a == 0 or len_b == 0:
                continue
            ratio = min(len_a, len_b) / max(len_a, len_b)
            if ratio < 0.7:  # More than 30% difference in length, skip
                continue

            score = fuzz.token_sort_ratio(a["normalized"], b["normalized"])
            if score >= threshold:
                group_counter = _add_fuzzy_match(
                    groups,
                    fuzzy_group_by_entry,
                    group_counter,
                    a,
                    b,
                    score / 100,
                )
                used_ids.add(a["id"])
                used_ids.add(b["id"])

    return groups


def _blocking_tokens(
    entry: Dict,
    token_frequency: Counter[str],
    max_bucket_size: int,
) -> list[str]:
    tokens = sorted(
        set(entry["tokens"]),
        key=lambda token: (token_frequency[token], token),
    )
    return [
        token
        for token in tokens[:8]
        if token_frequency[token] <= max_bucket_size
    ]


def _candidate_entries(
    entry: Dict,
    token_index: dict[str, list[Dict]],
    token_frequency: Counter[str],
    max_bucket_size: int,
) -> list[Dict]:
    candidates: dict[int, Dict] = {}
    for token in _blocking_tokens(entry, token_frequency, max_bucket_size):
        for candidate in token_index.get(token, []):
            if candidate["id"] > entry["id"]:
                candidates[candidate["id"]] = candidate
    return list(candidates.values())


def _add_fuzzy_match(
    groups: list[DuplicateGroup],
    fuzzy_group_by_entry: dict[int, DuplicateGroup],
    group_counter: int,
    a: Dict,
    b: Dict,
    similarity: float,
) -> int:
    group_a = fuzzy_group_by_entry.get(a["id"])
    group_b = fuzzy_group_by_entry.get(b["id"])

    if group_a and group_b and group_a is group_b:
        return group_counter

    if group_a and group_b:
        known_ids = {member.entry_id for member in group_a.members}
        for member in group_b.members:
            if member.entry_id not in known_ids:
                group_a.members.append(member)
                fuzzy_group_by_entry[member.entry_id] = group_a
        groups.remove(group_b)
        return group_counter

    group = group_a or group_b
    if group:
        existing_ids = {member.entry_id for member in group.members}
        for entry in (a, b):
            if entry["id"] not in existing_ids:
                group.members.append(DuplicateMatch(entry["id"], entry["file"], entry["content"], similarity))
                fuzzy_group_by_entry[entry["id"]] = group
        return group_counter

    group_counter += 1
    group = DuplicateGroup(
        group_id=group_counter,
        type="fuzzy",
        members=[
            DuplicateMatch(a["id"], a["file"], a["content"], 1.0),
            DuplicateMatch(b["id"], b["file"], b["content"], similarity),
        ],
    )
    groups.append(group)
    fuzzy_group_by_entry[a["id"]] = group
    fuzzy_group_by_entry[b["id"]] = group
    return group_counter
