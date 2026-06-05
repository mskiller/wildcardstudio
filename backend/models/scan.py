from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime

from services.time_utils import utc_now


class DuplicateGroup(SQLModel, table=True):
    __tablename__ = "duplicate_group"

    id: Optional[int] = Field(default=None, primary_key=True)
    scan_date: datetime = Field(default_factory=utc_now)
    status: str = Field(default="pending")          # 'pending' | 'merged' | 'ignored'


class DuplicateMember(SQLModel, table=True):
    __tablename__ = "duplicate_member"

    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: Optional[int] = Field(default=None, foreign_key="duplicate_group.id")
    entry_id: Optional[int] = Field(default=None, foreign_key="wildcard_entry.id")
    similarity: Optional[float] = None             # score 0.0–1.0
