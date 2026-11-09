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
    # 内容作者（阶段 1：多成员共用一套后台，靠它区分归属）
    # NULL = 迁移前的历史数据，展示时按站长处理
    author_id: int | None = Field(default=None, foreign_key="admin.id", index=True)


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
    # 内容作者（阶段 1：多成员共用一套后台，靠它区分归属）
    # NULL = 迁移前的历史数据，展示时按站长处理
    author_id: int | None = Field(default=None, foreign_key="admin.id", index=True)

    # 审核状态：none/approved 视为已通过；pending 待审；rejected 驳回
    # 历史数据迁移时统一置为 approved —— 线上表现不变，之后成员新提交的才进审核
    review_status: str = Field(default="approved", max_length=20, index=True)

    # 审核意见（驳回理由）。通过时清空。成员在后台能看到这一句。
    review_note: str | None = Field(default=None, max_length=500)

    # 是否对公众可见（与 review_status 正交：草稿/待审/已发布是两条轴）
    status: str = Field(default="published", max_length=20, index=True)

    created_at: datetime = Field(default_factory=utcnow, index=True)
