"""
Token counting for CLIP (77 token limit) and T5 approximation.
Uses tiktoken for cl100k_base or p50k_base.
"""
import re
from typing import Dict
from config import get_settings

settings = get_settings()

_encoder = None


def _get_encoder():
    global _encoder
    if _encoder is None:
        try:
            import tiktoken
            _encoder = tiktoken.get_encoding(settings.token_model)
        except Exception:
            _encoder = None
    return _encoder


def count_tokens(text: str) -> Dict:
    """
    Returns dict with clip_tokens, t5_tokens (approx), and over_limit flag.
    CLIP limit is 77 tokens.
    """
    # Clean wildcards syntax for counting
    clean = re.sub(r"__\w+__", "", text)
    clean = re.sub(r"\{[^}]*\}", "", clean)
    clean = clean.strip()

    encoder = _get_encoder()
    if encoder:
        try:
            clip_tokens = len(encoder.encode(clean))
        except Exception:
            clip_tokens = _approximate_tokens(clean)
    else:
        clip_tokens = _approximate_tokens(clean)

    # T5 approximation: ~1.3 tokens per word
    words = len(clean.split())
    t5_tokens = int(words * 1.3)

    return {
        "clip_tokens": clip_tokens,
        "t5_tokens": t5_tokens,
        "clip_limit": 77,
        "over_limit": clip_tokens > 77,
        "text_length": len(clean),
    }


def _approximate_tokens(text: str) -> int:
    """Rough approximation: ~0.75 tokens per character average."""
    return max(1, len(text) // 4)
