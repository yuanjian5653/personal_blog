"""
随笔（说说）模型
"""
from datetime import datetime

from sqlalchemy import Text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import SQLModel, Field, Column

from app.models._base import utcnow


class Essay(SQLModel, table=True):
    __tablename__ = "essays"

    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(default="", max_length=200)
    content: str = Field(default="", sa_column=Column(LONGTEXT, nullable=False))
    excerpt: str | None = Field(default=None, max_length=500)
    # JSON 字符串数组，如 ["a.jpg","b.jpg"]
    images: str | None = Field(default=None, sa_column=Column(Text))
    likes: int = Field(default=0)

    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow)
