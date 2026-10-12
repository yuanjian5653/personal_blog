from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class AdminSession(SQLModel, table=True):
    __tablename__ = "admin_sessions"

    id: int | None = Field(default=None, primary_key=True)
    admin_id: int = Field(foreign_key="admin.id", index=True)
    session_token: str = Field(unique=True, index=True, max_length=128)
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=utcnow)
