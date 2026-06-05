"""Seed default tag categories on first startup."""
from sqlmodel import Session, select
from database import engine
from models.tag import TagCategory

DEFAULT_CATEGORIES = [
    {"name": "subject",    "color": "#6366f1", "icon": "👤", "position": 1},
    {"name": "style",      "color": "#8b5cf6", "icon": "🎨", "position": 2},
    {"name": "quality",    "color": "#ec4899", "icon": "⭐", "position": 3},
    {"name": "lighting",   "color": "#f59e0b", "icon": "💡", "position": 4},
    {"name": "camera",     "color": "#10b981", "icon": "📷", "position": 5},
    {"name": "character",  "color": "#f43f5e", "icon": "🧑‍🎤", "position": 6},
    {"name": "artist",     "color": "#3b82f6", "icon": "✏️",  "position": 7},
    {"name": "expression", "color": "#f97316", "icon": "😊", "position": 8},
    {"name": "clothing",   "color": "#84cc16", "icon": "👗", "position": 9},
    {"name": "background", "color": "#06b6d4", "icon": "🏞️",  "position": 10},
    {"name": "nsfw",       "color": "#ef4444", "icon": "🔞", "position": 11},
]


def seed_default_categories():
    with Session(engine) as session:
        for cat in DEFAULT_CATEGORIES:
            existing = session.exec(
                select(TagCategory).where(TagCategory.name == cat["name"])
            ).first()
            if not existing:
                session.add(TagCategory(**cat))
        session.commit()
