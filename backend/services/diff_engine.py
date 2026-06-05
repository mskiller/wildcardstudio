"""
Token-level diff engine for prompt comparison.
Tokenizes by tag (comma-split) or by word (NL), then diffs.
"""
import re
import difflib
from typing import List, Dict, Tuple


def tokenize(text: str, mode: str = "auto") -> List[str]:
    """
    Split a prompt into tokens.
    mode: 'tag' | 'nl' | 'auto'
    """
    if not text:
        return []

    if mode == "auto":
        # Detect: if comma-heavy → tag mode
        comma_count = text.count(",")
        word_count = len(text.split())
        mode = "tag" if (comma_count > 0 and comma_count / max(word_count, 1) > 0.05) else "nl"

    if mode == "tag":
        # Split on commas, strip whitespace and empty
        tokens = [t.strip() for t in text.split(",") if t.strip()]
        # Normalize weights: (tag:1.0) → tag
        tokens = [re.sub(r"\((.+):\d+(?:\.\d+)?\)", r"\1", t).strip() for t in tokens]
        return [t for t in tokens if t]
    else:
        # NL: split on spaces, keep punctuation attached
        return text.split()


def compute_diff(left: str, right: str, mode: str = "auto") -> Dict:
    """
    Compute token-level diff between two prompts.
    Returns dict with diff operations, similarity scores, and token sets.
    """
    left_tokens = tokenize(left, mode)
    right_tokens = tokenize(right, mode)

    left_set = set(t.lower() for t in left_tokens)
    right_set = set(t.lower() for t in right_tokens)

    common = left_set & right_set
    left_only = left_set - right_set
    right_only = right_set - left_set

    # Jaccard similarity
    union = left_set | right_set
    jaccard = len(common) / len(union) if union else 1.0

    # Levenshtein-based similarity using SequenceMatcher
    matcher = difflib.SequenceMatcher(None, left_tokens, right_tokens)
    levenshtein_sim = matcher.ratio()

    # Build diff operations
    diff_ops = []
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            diff_ops.append({"op": "equal", "tokens": left_tokens[i1:i2]})
        elif opcode == "delete":
            diff_ops.append({"op": "delete", "tokens": left_tokens[i1:i2]})
        elif opcode == "insert":
            diff_ops.append({"op": "insert", "tokens": right_tokens[j1:j2]})
        elif opcode == "replace":
            diff_ops.append({"op": "delete", "tokens": left_tokens[i1:i2]})
            diff_ops.append({"op": "insert", "tokens": right_tokens[j1:j2]})

    return {
        "similarity_jaccard": round(jaccard, 4),
        "similarity_levenshtein": round(levenshtein_sim, 4),
        "left_only": sorted(left_only),
        "right_only": sorted(right_only),
        "common": sorted(common),
        "left_token_count": len(left_tokens),
        "right_token_count": len(right_tokens),
        "diff": diff_ops,
    }
