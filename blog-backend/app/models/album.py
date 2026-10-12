"""
图片组模型
每个图片组是一个相册，包含多张图片
"""
from datetime import datetime

from sqlalchemy import Text
from sqlmodel import SQLModel, Field, Column

from app.models._base import utcnow


class Album(SQLModel, table=True):
    __tablename__ = "albums"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=100, index=True)
    description: str | None = Field(default=None, sa_column=Column(Text))
    # 封面图，相对 media/photos/ 的路径
    cover_path: str | None = Field(default=None, max_length=500)
    # 日期标签，比如 "2025.10"
    date_label: str | None = Field(default=None, max_length=20)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)


class Photo(SQLModel, table=True):
    __tablename__ = "photos"

    id: int | None = Field(default=None, primary_key=True)
    album_id: int = Field(foreign_key="albums.id", index=True)
    # 相对 media/photos/ 的文件名，如 "abc123.jpg"
    file_path: str = Field(max_length=500)
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow, index=True)
