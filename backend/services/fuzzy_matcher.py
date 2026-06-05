"""
Two-pass duplicate detection:
  Pass 1 — exact duplicates via MD5 hash of normalized text
  Pass 2 — fuzzy duplicates via rapidfuzz token_sort_ratio
"""
import hashlib
import re
from difflib import SequenceMatcher
from typing import List, Dict, Tuple
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

    # Pass 1: exact duplicates
    hash_map: Dict[str, List[Dict]] = {}
    for entry in entries:
        h = md5_hash(normalize(entry["content"]))
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

    # Pass 2: fuzzy duplicates on remaining entries
    remaining = [e for e in entries if e["id"] not in used_ids]
    token_counts = {e["id"]: len(e["content"].split()) for e in remaining}

    processed_pairs = set()
    for i, a in enumerate(remaining):
        for j, b in enumerate(remaining):
            if i >= j:
                continue
            pair = (min(a["id"], b["id"]), max(a["id"], b["id"]))
            if pair in processed_pairs:
                continue

            # Optimization: skip entries with very different lengths
            len_a = token_counts[a["id"]]
            len_b = token_counts[b["id"]]
            if len_a == 0 or len_b == 0:
                continue
            ratio = min(len_a, len_b) / max(len_a, len_b)
            if ratio < 0.7:  # More than 30% difference in length, skip
                continue

            score = fuzz.token_sort_ratio(normalize(a["content"]), normalize(b["content"]))
            if score >= threshold:
                processed_pairs.add(pair)
                # Check if either is already in a fuzzy group
                merged = False
                for g in groups:
                    if g.type == "fuzzy":
                        ids = {m.entry_id for m in g.members}
                        if a["id"] in ids or b["id"] in ids:
                            # Add the other if not present
                            if a["id"] not in ids:
                                g.members.append(DuplicateMatch(a["id"], a["file"], a["content"], score / 100))
                                used_ids.add(a["id"])
                            if b["id"] not in ids:
                                g.members.append(DuplicateMatch(b["id"], b["file"], b["content"], score / 100))
                                used_ids.add(b["id"])
                            merged = True
                            break

                if not merged:
                    group_counter += 1
                    groups.append(DuplicateGroup(
                        group_id=group_counter,
                        type="fuzzy",
                        members=[
                            DuplicateMatch(a["id"], a["file"], a["content"], 1.0),
                            DuplicateMatch(b["id"], b["file"], b["content"], score / 100),
                        ],
                    ))
                    used_ids.add(a["id"])
                    used_ids.add(b["id"])

    return groups
