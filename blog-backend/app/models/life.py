"""
生活动态模型
"""
from datetime import datetime

from sqlalchemy import Text
from sqlmodel import SQLModel, Field, Column

from app.models._base import utcnow


class LifePost(SQLModel, table=True):
    __tablename__ = "life_posts"

    id: int | None = Field(default=None, primary_key=True)
    content: str = Field(default="", sa_column=Column(Text))
    # JSON 数组字符串，如 ["a.jpg","b.jpg"] 或 ["https://..."]
    images: str | None = Field(default=None, sa_column=Column(Text))
    location: str | None = Field(default=None, max_length=100)
    created_at: datetime = Field(default_factory=utcnow, index=True)
