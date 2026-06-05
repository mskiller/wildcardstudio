from datetime import UTC, datetime


def utc_now() -> datetime:
    """Return a naive UTC timestamp for SQLite compatibility."""
    return datetime.now(UTC).replace(tzinfo=None)


def utc_from_timestamp(timestamp: float) -> datetime:
    """Return a naive UTC datetime from a POSIX timestamp."""
    return datetime.fromtimestamp(timestamp, UTC).replace(tzinfo=None)
