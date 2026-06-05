"""
Local Git versioning for the wildcards directory.
"""
import os
from typing import List, Dict, Optional
from config import get_settings

settings = get_settings()


def _get_repo():
    """Get or initialize a Git repo in the wildcards directory."""
    try:
        from git import Repo, InvalidGitRepositoryError, GitCommandNotFound
        try:
            repo = Repo(settings.wildcards_path)
            return repo
        except InvalidGitRepositoryError:
            repo = Repo.init(settings.wildcards_path)
            # Configure user
            repo.config_writer().set_value("user", "name", settings.git_user_name).release()
            repo.config_writer().set_value("user", "email", settings.git_user_email).release()
            return repo
    except Exception:
        return None


def commit(message: str = "WildcardStudio: update wildcards") -> Optional[str]:
    """Stage all changes and commit. Returns commit hash or None."""
    repo = _get_repo()
    if repo is None:
        return None
    try:
        repo.git.add("-A")
        if not repo.index.diff("HEAD") and not repo.untracked_files:
            return None  # Nothing to commit
        commit_obj = repo.index.commit(message)
        return str(commit_obj.hexsha[:8])
    except Exception as e:
        return None


def get_log(n: int = 20) -> List[Dict]:
    """Return the last n commits."""
    repo = _get_repo()
    if repo is None:
        return []
    try:
        commits = []
        for c in list(repo.iter_commits(max_count=n)):
            commits.append({
                "hash": c.hexsha[:8],
                "full_hash": c.hexsha,
                "message": c.message.strip(),
                "date": c.committed_datetime.isoformat(),
                "author": c.author.name,
                "stats": {
                    "files": len(c.stats.files),
                    "insertions": c.stats.total["insertions"],
                    "deletions": c.stats.total["deletions"],
                },
            })
        return commits
    except Exception:
        return []


def diff(commit_a: Optional[str] = None, commit_b: Optional[str] = None) -> str:
    """Return diff between two commits or HEAD vs working tree."""
    repo = _get_repo()
    if repo is None:
        return ""
    try:
        if commit_a and commit_b:
            return repo.git.diff(commit_a, commit_b)
        elif commit_a:
            return repo.git.diff(commit_a)
        else:
            return repo.git.diff("HEAD")
    except Exception as e:
        return str(e)


def is_enabled() -> bool:
    return settings.git_enabled
