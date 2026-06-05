"""
Heuristic classifier to determine if a prompt is tag-style (Booru) or Natural Language.
Score-based system: 0–100 for each dimension.
"""
import re
from typing import Tuple

# Common Danbooru-style quality/meta tags
KNOWN_BOORU_TAGS = {
    "masterpiece", "best quality", "ultra-detailed", "1girl", "1boy", "solo", "multiple girls",
    "multiple boys", "smile", "looking at viewer", "school uniform", "white background",
    "simple background", "blush", "long hair", "short hair", "black hair", "blonde hair",
    "blue eyes", "red eyes", "green eyes", "large breasts", "small breasts", "nsfw",
    "explicit", "close-up", "wide shot", "full body", "upper body", "face", "portrait",
    "anime", "manga", "illustration", "digital art", "oil painting", "watercolor",
    "photorealistic", "hyperrealistic", "bokeh", "depth of field", "cinematic lighting",
    "dramatic lighting", "soft light", "golden hour", "night", "day", "indoors", "outdoors",
    "wlop", "artgerm", "greg rutkowski",
}


def detect_style(text: str) -> Tuple[str, int, int]:
    """
    Returns (style, tag_score, nl_score).
    style is 'tag' | 'nl' | 'mixed' | 'unknown'
    """
    if not text or not text.strip():
        return "unknown", 0, 0

    tag_score = 0
    nl_score = 0

    # Signal 1: commas as primary separators (+30 TAG)
    comma_count = text.count(",")
    words = text.split()
    if comma_count > 0 and comma_count / max(len(words), 1) > 0.1:
        tag_score += 30

    # Signal 2: (tag:weight) patterns (+25 TAG)
    if re.search(r"\([^)]+:\d+(?:\.\d+)?\)", text):
        tag_score += 25

    # Signal 3: average token length < 2 words (+20 TAG)
    tokens = [t.strip() for t in re.split(r",", text) if t.strip()]
    if tokens:
        avg_token_words = sum(len(t.split()) for t in tokens) / len(tokens)
        if avg_token_words < 2.0:
            tag_score += 20

    # Signal 4: known Danbooru tags present (+20 TAG)
    text_lower = text.lower()
    known_count = sum(1 for tag in KNOWN_BOORU_TAGS if tag in text_lower)
    if known_count >= 2:
        tag_score += 20
    elif known_count == 1:
        tag_score += 10

    # Signal 5: verb patterns (+30 NL)
    verb_patterns = [
        r"\b(is|are|was|were|has|have|had|do|does|did|will|would|can|could|should|may|might|must)\b",
        r"\b\w+(ing|ed|s)\b",
    ]
    for pat in verb_patterns[:1]:  # Only first, more reliable
        if re.search(pat, text, re.IGNORECASE):
            nl_score += 30

    # Signal 6: long sequences without commas (+20 NL)
    segments = text.split(",")
    long_segments = [s for s in segments if len(s.split()) > 8]
    if long_segments:
        nl_score += 20

    # Signal 7: articles (+25 NL)
    if re.search(r"\b(a|an|the|un|une|le|la|les)\b", text, re.IGNORECASE):
        nl_score += 25

    # Signal 8: sentence-ending punctuation (+15 NL)
    if re.search(r"[.!?]\s*$", text.strip()):
        nl_score += 15

    # Determine style
    if tag_score > 50 and nl_score <= 50:
        style = "tag"
    elif nl_score > 50 and tag_score <= 50:
        style = "nl"
    elif tag_score > 50 and nl_score > 50:
        style = "mixed"
    else:
        style = "unknown"

    return style, tag_score, nl_score


def classify_scores(scores: list[Tuple[str, int, int]]) -> str:
    """Classify pre-scored entries and return the dominant style."""
    if not scores:
        return "unknown"
    styles = {"tag": 0, "nl": 0, "mixed": 0, "unknown": 0}
    for style, _, _ in scores:
        styles[style] += 1
    total = sum(styles.values())
    if total == 0:
        return "unknown"
    dominant = max(styles, key=styles.get)
    # If dominant < 60% of entries, call it mixed
    if styles[dominant] / total < 0.6:
        return "mixed"
    return dominant


def classify_entries(entries: list) -> str:
    """Classify a list of entries and return the dominant style."""
    return classify_scores([detect_style(str(content)) for content in entries])


def approximate_nl_to_tag(text: str) -> str:
    """
    Very rough heuristic conversion NL → TAG.
    Groups tokens by semantic category and builds a comma-separated list.
    """
    # Remove articles and filler words
    filler = r"\b(a|an|the|is|are|was|with|and|of|in|on|at|to|for|that|this|these|those)\b"
    cleaned = re.sub(filler, "", text, flags=re.IGNORECASE)
    # Split on spaces and commas, filter empties
    tokens = [t.strip(".,!?;:") for t in re.split(r"[\s,]+", cleaned) if t.strip(".,!?;:")]
    return ", ".join(tokens)
