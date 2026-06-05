"""F03 · Éditeur intelligent"""
import os
import re
import random
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List, Optional
from sqlmodel import Session, select

from config import get_settings
from database import get_session
from models.wildcard import WildcardFile, WildcardEntry
from services.token_counter import count_tokens
from services.nl_detector import detect_style
from services.yaml_parser import parse_file

router = APIRouter()
settings = get_settings()


class AutocompleteRequest(BaseModel):
    prefix: str
    limit: int = 10


class ResolveRequest(BaseModel):
    prompt: str
    n: int = 3
    max_depth: int = 3


class TokenCountRequest(BaseModel):
    text: str


class ValidateRequest(BaseModel):
    prompt: str


@router.post("/autocomplete")
def autocomplete(req: AutocompleteRequest, session: Session = Depends(get_session)):
    prefix = req.prefix.lower().lstrip("_")
    files = session.exec(select(WildcardFile)).all()
    matches = [
        {"path": f.path, "format": f.format, "entry_count": f.entry_count}
        for f in files
        if prefix in f.path.lower() or prefix in f.filename.lower()
    ]
    return {"suggestions": matches[:req.limit]}


@router.post("/resolve")
def resolve_prompt(req: ResolveRequest, session: Session = Depends(get_session)):
    """Replace __wildcard__ tokens with random entries from matching files."""
    results = []
    for _ in range(req.n):
        resolved = _resolve(req.prompt, session, req.max_depth, depth=0)
        results.append(resolved)
    return {"variants": results}


def _resolve(prompt: str, session: Session, max_depth: int, depth: int) -> str:
    if depth >= max_depth:
        return prompt

    def replacer(match):
        name = match.group(1)
        # Search for matching file by name
        files = session.exec(select(WildcardFile)).all()
        for f in files:
            base = os.path.splitext(f.filename)[0]
            if base == name or f.path.replace("/", "_").rstrip(".yaml").rstrip(".txt") == name:
                entries = session.exec(
                    select(WildcardEntry).where(WildcardEntry.file_id == f.id)
                ).all()
                if entries:
                    chosen = random.choice(entries)
                    return _resolve(chosen.content, session, max_depth, depth + 1)
        return f"[MISSING:{name}]"

    return re.sub(r"__(\w+)__", replacer, prompt)


@router.post("/tokencount")
def token_count(req: TokenCountRequest):
    return count_tokens(req.text)


@router.post("/validate")
def validate_prompt(req: ValidateRequest):
    style, tag_score, nl_score = detect_style(req.prompt)
    tokens = count_tokens(req.prompt)

    # Check for undefined wildcards
    wildcards = re.findall(r"__(\w+)__", req.prompt)

    # Check for unclosed braces
    open_braces = req.prompt.count("{")
    close_braces = req.prompt.count("}")

    warnings = []
    if tokens["over_limit"]:
        warnings.append(f"CLIP token limit exceeded: {tokens['clip_tokens']}/77")
    if open_braces != close_braces:
        warnings.append(f"Unmatched braces: {open_braces} open, {close_braces} close")

    return {
        "style": style,
        "tag_score": tag_score,
        "nl_score": nl_score,
        "tokens": tokens,
        "wildcards_referenced": wildcards,
        "warnings": warnings,
        "valid": len(warnings) == 0,
    }
