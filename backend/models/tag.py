from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime

from services.time_utils import utc_now


class TagCategory(SQLModel, table=True):
    __tablename__ = "tag_category"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    parent_id: Optional[int] = Field(default=None, foreign_key="tag_category.id")
    color: Optional[str] = None
    icon: Optional[str] = None
    position: int = Field(default=0)


class Tag(SQLModel, table=True):
    __tablename__ = "tag"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    category_id: Optional[int] = Field(default=None, foreign_key="tag_category.id")
    aliases: Optional[str] = None                  # JSON array of synonyms
    weight: float = Field(default=1.0)
    usage_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=utc_now)
