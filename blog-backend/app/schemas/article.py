from datetime import datetime
from pydantic import BaseModel, Field


class ArticleRead(BaseModel):
    id: int
    title: str
    slug: str
    content: str
    excerpt: str | None = None
    cover_path: str | None = None
    category: str | None = None
    tags: str | None = None
    is_pinned: bool = False
    read_time: int = 0
    word_count: int = 0
    view_count: int = 0
    like_count: int = 0
    status: str
    created_at: datetime
    updated_at: datetime
    # 内容作者（成员标签用）。列表接口只给 id，
    # 显示名和头像由前端通过 GET /api/authors 一次性取回后本地关联。
    author_id: int | None = None

    class Config:
        from_attributes = True
    review_status: str = "approved"
    review_note: str | None = None

class ArticleListItem(BaseModel):
    """列表页用（不含 content）"""
    id: int
    title: str
    slug: str
    excerpt: str | None = None
    cover_path: str | None = None
    category: str | None = None
    tags: str | None = None
    is_pinned: bool = False
    read_time: int = 0
    word_count: int = 0
    view_count: int = 0
    like_count: int = 0
    status: str
    created_at: datetime
    # 内容作者（成员标签用）。列表接口只给 id，
    # 显示名和头像由前端通过 GET /api/authors 一次性取回后本地关联。
    author_id: int | None = None

    class Config:
        from_attributes = True


class ArticleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    slug: str | None = None
    content: str = ""
    excerpt: str | None = None
    cover_path: str | None = None
    category: str | None = None
    tags: str | None = None
    is_pinned: bool = False
    status: str = "published"


class ArticleUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    content: str | None = None
    excerpt: str | None = None
    cover_path: str | None = None
    category: str | None = None
    tags: str | None = None
    is_pinned: bool | None = None
    status: str | None = None