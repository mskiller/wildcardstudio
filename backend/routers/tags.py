"""F04 · Gestionnaire de tags"""
from collections import Counter
import json
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from database import get_session
from models.tag import Tag, TagCategory
from models.wildcard import WildcardEntry, WildcardFile
from services.time_utils import utc_now

router = APIRouter()


class TagCreate(BaseModel):
    name: str
    category_id: Optional[int] = None
    aliases: Optional[List[str]] = None
    weight: float = 1.0


class TagUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[int] = None
    aliases: Optional[List[str]] = None
    weight: Optional[float] = None


class CategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    position: int = 0


class MergeRequest(BaseModel):
    keep_id: int
    remove_id: int


@router.get("/")
def list_tags(
    category: Optional[int] = None,
    q: Optional[str] = None,
    session: Session = Depends(get_session),
):
    query = select(Tag)
    tags = session.exec(query).all()
    if category is not None:
        tags = [t for t in tags if t.category_id == category]
    if q:
        q_lower = q.lower()
        tags = [t for t in tags if q_lower in t.name.lower()]
    if not tags:
        return _derived_tags(session, category=category, q=q)
    return tags


@router.post("/")
def create_tag(body: TagCreate, session: Session = Depends(get_session)):
    tag = Tag(
        name=body.name,
        category_id=body.category_id,
        aliases=json.dumps(body.aliases or []),
        weight=body.weight,
    )
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag


@router.put("/{tag_id}")
def update_tag(tag_id: int, body: TagUpdate, session: Session = Depends(get_session)):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(404, "Tag not found")
    if body.name is not None:
        tag.name = body.name
    if body.category_id is not None:
        tag.category_id = body.category_id
    if body.aliases is not None:
        tag.aliases = json.dumps(body.aliases)
    if body.weight is not None:
        tag.weight = body.weight
    session.commit()
    session.refresh(tag)
    return tag


@router.delete("/{tag_id}")
def delete_tag(tag_id: int, session: Session = Depends(get_session)):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(404, "Tag not found")
    session.delete(tag)
    session.commit()
    return {"ok": True}


@router.get("/categories")
def list_categories(session: Session = Depends(get_session)):
    cats = session.exec(select(TagCategory).order_by(TagCategory.position)).all()
    return cats


@router.post("/categories")
def create_category(body: CategoryCreate, session: Session = Depends(get_session)):
    cat = TagCategory(**body.dict())
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat


@router.put("/categories/{cat_id}")
def update_category(cat_id: int, body: CategoryCreate, session: Session = Depends(get_session)):
    cat = session.get(TagCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Category not found")
    for k, v in body.dict(exclude_unset=True).items():
        setattr(cat, k, v)
    session.commit()
    session.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, session: Session = Depends(get_session)):
    cat = session.get(TagCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Category not found")
    session.delete(cat)
    session.commit()
    return {"ok": True}


@router.post("/merge")
def merge_tags(body: MergeRequest, session: Session = Depends(get_session)):
    keep = session.get(Tag, body.keep_id)
    remove = session.get(Tag, body.remove_id)
    if not keep or not remove:
        raise HTTPException(404, "Tag not found")
    # Add remove tag name to keep's aliases
    aliases = json.loads(keep.aliases or "[]")
    if remove.name not in aliases:
        aliases.append(remove.name)
    keep.aliases = json.dumps(aliases)
    session.delete(remove)
    session.commit()
    return {"ok": True, "kept": keep.name}


@router.post("/import-from-wildcards")
def import_from_wildcards(session: Session = Depends(get_session)):
    """Extract unique tokens from wildcard entries and add/update persisted tags."""
    derived = _derived_tags(session, limit=2000)
    existing = {t.name: t for t in session.exec(select(Tag)).all()}
    new_tags: list[str] = []
    updated = 0

    for item in derived:
        name = item["name"]
        tag = existing.get(name)
        if tag:
            if item["usage_count"] > (tag.usage_count or 0):
                tag.usage_count = item["usage_count"]
                updated += 1
            if tag.category_id is None and item["category_id"] is not None:
                tag.category_id = item["category_id"]
                updated += 1
            continue
        tag = Tag(
            name=name,
            category_id=item["category_id"],
            aliases=json.dumps([]),
            usage_count=item["usage_count"],
            weight=1.0,
        )
        session.add(tag)
        existing[name] = tag
        new_tags.append(name)

    session.commit()
    return {"imported": len(new_tags), "updated": updated, "tags": new_tags[:100]}


def _derived_tags(
    session: Session,
    category: Optional[int] = None,
    q: Optional[str] = None,
    limit: int = 500,
) -> list[dict]:
    categories = {cat.name.lower(): cat.id for cat in session.exec(select(TagCategory)).all()}
    counts: Counter[str] = Counter()
    category_ids: dict[str, Optional[int]] = {}
    q_lower = q.lower() if q else None
    character_category_id = categories.get("character")
    category_is_character = category is not None and category == character_category_id
    character_file_ids = _character_file_ids(session)
    statement = (
        select(
            WildcardEntry.tag_signature,
            WildcardEntry.content,
            WildcardEntry.prompt_style,
            WildcardFile.path,
        )
        .where(WildcardEntry.file_id == WildcardFile.id)
    )
    if q_lower:
        statement = statement.where(WildcardEntry.content.ilike(f"%{q_lower}%"))
    if category_is_character:
        if not character_file_ids:
            return []
        statement = statement.where(WildcardEntry.file_id.in_(character_file_ids))
    elif category is not None and character_file_ids:
        statement = statement.where(WildcardEntry.file_id.not_in(character_file_ids))
    rows = session.exec(statement)

    for tag_signature, content, prompt_style, path in rows:
        is_character_source = _is_character_source(path)
        for token, forced_category in _tokens_from_entry(
            tag_signature=tag_signature,
            content=content,
            prompt_style=prompt_style,
            path=path,
            is_character_source=is_character_source,
        ):
            counts[token] += 1
            if token not in category_ids:
                if forced_category and forced_category in categories:
                    category_ids[token] = categories[forced_category]
                else:
                    category_ids[token] = _guess_category_id(token, categories, path)

    tags = []
    filtered = []
    for name, usage_count in counts.items():
        category_id = category_ids.get(name)
        if category is not None and category_id != category:
            continue
        if q_lower and q_lower not in name:
            continue
        filtered.append((name, usage_count, category_id))

    filtered.sort(key=lambda item: (-item[1], item[0]))
    for index, (name, usage_count, category_id) in enumerate(filtered[:limit], start=1):
        tags.append({
            "id": -index,
            "name": name,
            "category_id": category_id,
            "aliases": "[]",
            "weight": 1.0,
            "usage_count": usage_count,
            "created_at": utc_now(),
            "source": "wildcard_index",
        })
    return tags


def _tokens_from_entry(
    tag_signature: Optional[str],
    content: str,
    prompt_style: Optional[str],
    path: str,
    is_character_source: Optional[bool] = None,
) -> list[tuple[str, Optional[str]]]:
    source_is_character = (
        is_character_source if is_character_source is not None else _is_character_source(path)
    )
    if source_is_character:
        return [(token, "character") for token in _character_tokens_from_content(content)]

    raw_tokens = _json_list(tag_signature)
    if not raw_tokens:
        if prompt_style not in {"tag", "mixed"} and "," not in content:
            return []
        raw_tokens = content.split(",")
    tokens: list[tuple[str, Optional[str]]] = []
    for raw in raw_tokens:
        token = _clean_token(str(raw))
        if token:
            tokens.append((token, None))
    return tokens


def _json_list(value: Optional[str]) -> list[str]:
    if not value:
        return []
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError:
        return []
    if isinstance(loaded, list):
        return [str(item) for item in loaded]
    return []


def _clean_token(value: str) -> str:
    token = re.sub(r"\((.+):\d+(?:\.\d+)?\)", r"\1", value)
    token = re.sub(r"\b\d+::", "", token)
    token = re.sub(r":\d+(?:\.\d+)?\)?$", "", token)
    token = re.sub(r"[()]", " ", token)
    token = token.replace("{", "").replace("}", "")
    token = token.strip().strip("()[]{} ,.;:|").lower()
    token = re.sub(r"\s+", " ", token)
    if "|" in token:
        return ""
    if not token or token.startswith("__"):
        return ""
    if len(token) > 80:
        return ""
    if not re.search(r"[a-z0-9]", token):
        return ""
    if token in {
        "and", "or", "the", "a", "an", "with", "of", "in", "to", "that", "from",
        "between", "for", "on", "is", "at", "by", "are", "where", "this", "these",
        "those",
    }:
        return ""
    return token


def _is_character_source(path: str) -> bool:
    normalized = path.replace("\\", "/").lower()
    stem = normalized.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    words = {part for part in re.split(r"[^a-z0-9]+", stem) if part}
    if words & {"character", "characters", "char", "chars", "chr", "celeb", "celebs"}:
        return True
    if "card" in words and (words & {"male", "female", "mklan", "lucie"}):
        return True
    return False


def _character_file_ids(session: Session) -> list[int]:
    return [
        file_id
        for file_id, path in session.exec(select(WildcardFile.id, WildcardFile.path))
        if file_id is not None and _is_character_source(path)
    ]


def _character_tokens_from_content(content: str) -> list[str]:
    if not content or content.strip().startswith(("#", "__")):
        return []

    tokens: list[str] = []
    for candidate in _character_candidates(content, limit=20):
        segment = _first_character_segment(_collapse_variant_blocks(candidate))
        token = _clean_character_token(segment)
        if token and token not in tokens:
            tokens.append(token)
    return tokens


def _character_candidates(value: str, limit: int = 20) -> list[str]:
    stripped = value.strip()
    match = re.match(r"^\{([^{}]*\|[^{}]*)\}(.*)$", stripped)
    if not match:
        return [stripped]

    variants = [part.strip() for part in match.group(1).split("|")]
    suffix = match.group(2).strip()
    candidates: list[str] = []
    for variant in variants:
        if not variant:
            continue
        if len(candidates) >= limit:
            break
        candidates.append(f"{variant} {suffix}".strip())
    return candidates or [stripped]


def _collapse_variant_blocks(value: str) -> str:
    def replacement(match: re.Match) -> str:
        variants = [part.strip() for part in match.group(1).split("|")]
        return next((variant for variant in variants if variant), "")

    return re.sub(r"\{([^{}]*\|[^{}]*)\}", replacement, value)


def _first_character_segment(value: str) -> str:
    depth = 0
    for index, char in enumerate(value):
        if char in "({[":
            depth += 1
        elif char in ")}]":
            depth = max(0, depth - 1)
        elif char == "," and depth == 0:
            return value[:index]
    if value.lstrip().startswith("(") and "," in value:
        return value.split(",", 1)[0]
    return value


def _clean_character_token(value: str) -> str:
    token = re.sub(r"__[^_]+__", " ", value)
    token = re.sub(r"\{\|[^{}]*\}", " ", token)
    token = _clean_token(token)
    if token in {"male", "female", "character", "celeb", "celebrity"}:
        return ""
    return token


def _guess_category_id(
    token: str,
    categories: dict[str, int],
    path: Optional[str] = None,
) -> Optional[int]:
    if path and "character" in categories and _is_character_source(path):
        return categories["character"]
    checks = [
        ("quality", ("quality", "masterpiece", "detailed", "best")),
        ("lighting", ("light", "lighting", "shadow", "sunset", "golden hour", "neon")),
        ("camera", ("camera", "shot", "angle", "lens", "close-up", "portrait", "wide")),
        ("artist", ("artist", "style of", "by ")),
        ("expression", ("smile", "angry", "sad", "happy", "expression", "laugh")),
        ("clothing", ("dress", "shirt", "skirt", "uniform", "clothes", "outfit", "wearing")),
        ("background", ("background", "city", "forest", "beach", "room", "scenery")),
        ("nsfw", ("nsfw", "explicit", "nude", "sex", "erotic")),
        ("subject", ("girl", "boy", "woman", "man", "person", "animal", "creature")),
        ("style", ("anime", "manga", "comic", "realistic", "cinematic", "illustration")),
    ]
    for category_name, keywords in checks:
        if category_name in categories and any(keyword in token for keyword in keywords):
            return categories[category_name]
    return None
