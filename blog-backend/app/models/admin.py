from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class Admin(SQLModel, table=True):
    __tablename__ = "admin"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True, max_length=50)
    password_hash: str = Field(max_length=255)
    created_at: datetime = Field(default_factory=utcnow)
