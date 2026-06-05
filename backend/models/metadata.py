from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from services.time_utils import utc_now


class WildcardFileMetadata(SQLModel, table=True):
    __tablename__ = "wildcard_file_metadata"

    id: Optional[int] = Field(default=None, primary_key=True)
    file_path: str = Field(unique=True, index=True)
    category: Optional[str] = Field(default=None, index=True)
    status: Optional[str] = Field(default=None, index=True)
    favorite: bool = Field(default=False, index=True)
    notes: Optional[str] = Field(default=None, sa_column=Column(Text))
    classification_override: Optional[str] = Field(default=None, index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class WildcardEntryMetadata(SQLModel, table=True):
    __tablename__ = "wildcard_entry_metadata"
    __table_args__ = (
        UniqueConstraint("file_path", "line_number", name="uq_entry_metadata_file_line"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    entry_id: Optional[int] = Field(default=None, index=True)
    file_path: str = Field(index=True)
    line_number: Optional[int] = Field(default=None, index=True)
    content_hash: Optional[str] = Field(default=None, index=True)
    category: Optional[str] = Field(default=None, index=True)
    status: Optional[str] = Field(default=None, index=True)
    favorite: bool = Field(default=False, index=True)
    notes: Optional[str] = Field(default=None, sa_column=Column(Text))
    classification_override: Optional[str] = Field(default=None, index=True)
    updated_at: datetime = Field(default_factory=utc_now)
