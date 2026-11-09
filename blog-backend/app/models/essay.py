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

    # 内容作者（阶段 1：多成员共用一套后台，靠它区分归属）
    # NULL = 迁移前的历史数据，展示时按站长处理
    author_id: int | None = Field(default=None, foreign_key="admin.id", index=True)

    # 审核状态：none/approved 视为已通过；pending 待审；rejected 驳回
    # 历史数据迁移时统一置为 approved —— 线上表现不变，只有之后成员新提交的才进审核
    review_status: str = Field(default="approved", max_length=20, index=True)

    # 审核意见（驳回理由）。通过时清空。成员在后台能看到这一句。
    review_note: str | None = Field(default=None, max_length=500)

    # 是否对公众可见（与 review_status 正交：草稿/待审/已发布是两条轴）
    status: str = Field(default="published", max_length=20, index=True)

    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow)
