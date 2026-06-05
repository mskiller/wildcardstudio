from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime


class WildcardFile(SQLModel, table=True):
    __tablename__ = "wildcard_file"

    id: Optional[int] = Field(default=None, primary_key=True)
    path: str = Field(unique=True, index=True)       # relative path from /data/wildcards
    filename: str
    format: str                                       # 'impact' | 'dynamic_prompts'
    prompt_style: Optional[str] = None               # 'tag' | 'nl' | 'mixed' | 'unknown'
    entry_count: int = Field(default=0)
    blank_count: int = Field(default=0)
    comment_count: int = Field(default=0)
    wildcard_refs_count: int = Field(default=0)
    variants_count: int = Field(default=0)
    yaml_keys_count: int = Field(default=0)
    classification_score: Optional[float] = None
    classification_reasons: Optional[str] = None     # JSON object with detector details
    last_scanned: Optional[datetime] = None
    last_modified: Optional[datetime] = None
    checksum: Optional[str] = None

    entries: List["WildcardEntry"] = Relationship(back_populates="file")


class WildcardEntry(SQLModel, table=True):
    __tablename__ = "wildcard_entry"

    id: Optional[int] = Field(default=None, primary_key=True)
    file_id: Optional[int] = Field(default=None, foreign_key="wildcard_file.id", index=True)
    line_number: Optional[int] = None
    content: str
    weight: float = Field(default=1.0)
    prompt_style: Optional[str] = None              # 'tag' | 'nl' | 'unknown'
    normalized_content: Optional[str] = None
    tag_signature: Optional[str] = None             # JSON array of normalized tag tokens
    ref_signature: Optional[str] = None             # JSON array of wildcard refs
    syntax_signature: Optional[str] = None          # JSON object with syntax metrics
    wildcard_refs_count: int = Field(default=0)
    variants_count: int = Field(default=0)
    classification_score: Optional[float] = None
    classification_reasons: Optional[str] = None     # JSON object with detector details

    file: Optional[WildcardFile] = Relationship(back_populates="entries")
