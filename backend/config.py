from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    wildcards_path: str = "/data/wildcards"
    db_path: str = "/data/db/wildcardstudio.db"
    backups_path: str = "/data/backups"
    log_level: str = "info"
    max_upload_size_mb: int = 50
    default_similarity_threshold: int = 85
    backup_enabled: bool = True
    backup_schedule: str = "daily"
    backup_keep_last: int = 7
    token_model: str = "cl100k_base"
    git_enabled: bool = True
    git_auto_commit: bool = False
    git_user_name: str = "WildcardStudio"
    git_user_email: str = "local@wildcardstudio.local"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
