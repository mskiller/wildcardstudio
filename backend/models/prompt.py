from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
from pydantic import ConfigDict

from services.time_utils import utc_now


class PromptLibrary(SQLModel, table=True):
    __tablename__ = "prompt_library"
    model_config = ConfigDict(protected_namespaces=())

    id: Optional[int] = Field(default=None, primary_key=True)
    title: Optional[str] = None
    content: str
    prompt_style: Optional[str] = None              # 'tag' | 'nl'
    model_target: Optional[str] = None              # 'sdxl' | 'illustrious' | 'noobai' | 'other'
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = None
    image_path: Optional[str] = None
    tags_json: Optional[str] = None                 # JSON array of tag ids
    collection: Optional[str] = None
    token_count: Optional[int] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: Optional[datetime] = None


class MergeHistory(SQLModel, table=True):
    __tablename__ = "merge_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    merged_at: datetime = Field(default_factory=utc_now)
    source_files: str                               # JSON array of source file paths
    result_file: str
    backup_path: Optional[str] = None
    summary: Optional[str] = None
    status: str = Field(default="completed")        # 'completed' | 'rolled_back'


class AppSettings(SQLModel, table=True):
    __tablename__ = "settings"

    key: str = Field(primary_key=True)
    value: str


class GenerationHistory(SQLModel, table=True):
    __tablename__ = "generation_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str = Field(index=True)                # 'comfyui' | 'sdforge'
    base_url: str
    prompt: str
    negative_prompt: Optional[str] = None
    model: Optional[str] = None
    sampler: Optional[str] = None
    scheduler: Optional[str] = None
    steps: int = Field(default=30)
    cfg_scale: float = Field(default=7.0)
    seed: int = Field(default=-1)
    width: int = Field(default=1024)
    height: int = Field(default=1024)
    loras_json: Optional[str] = None                 # JSON array of selected LoRAs
    images_json: Optional[str] = None                # JSON array of saved image paths
    metadata_json: Optional[str] = None              # JSON connector response/request metadata
    status: str = Field(default="completed")         # 'completed' | 'failed'
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now, index=True)
