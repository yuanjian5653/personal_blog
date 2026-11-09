"""
文章模型
"""
from datetime import datetime

from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import SQLModel, Field, Column

from app.models._base import utcnow


class Article(SQLModel, table=True):
    __tablename__ = "articles"

    id: int | None = Field(default=None, primary_key=True)

    title: str = Field(max_length=200, index=True)
    slug: str = Field(unique=True, index=True, max_length=200)

    # LONGTEXT 支持 4GB，足够放任何长度的文章
    content: str = Field(
        default="",
        sa_column=Column(LONGTEXT, nullable=False),
    )
    excerpt: str | None = Field(default=None, max_length=500)
    cover_path: str | None = Field(default=None, max_length=500)

    category: str | None = Field(default=None, max_length=50, index=True)
    tags: str | None = Field(default=None, max_length=300)

    is_pinned: bool = Field(default=False)

    read_time: int = Field(default=0)
    word_count: int = Field(default=0)
    view_count: int = Field(default=0)
    like_count: int = Field(default=0)

    status: str = Field(default="published", max_length=20, index=True)

    # 内容作者（阶段 1：多成员共用一套后台，靠它区分归属）
    # NULL = 迁移前的历史数据，展示时按站长处理
    author_id: int | None = Field(default=None, foreign_key="admin.id", index=True)

    # 审核状态：none/approved 视为已通过；pending 待审；rejected 驳回
    # 历史数据迁移时统一置为 approved —— 线上表现不变，只有之后成员新提交的才进审核
    review_status: str = Field(default="approved", max_length=20, index=True)

    # 审核意见（驳回理由）。通过时清空。成员在后台能看到这一句。
    review_note: str | None = Field(default=None, max_length=500)

    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow)
