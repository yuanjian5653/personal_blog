from datetime import datetime
from pydantic import BaseModel, Field


class EssayRead(BaseModel):
    id: int
    title: str
    content: str
    excerpt: str | None = None
    images: list[str] = []
    likes: int = 0
    created_at: datetime
    updated_at: datetime
    # 内容作者（成员标签用）。列表接口只给 id，
    # 显示名和头像由前端通过 GET /api/authors 一次性取回后本地关联。
    author_id: int | None = None

    class Config:
        from_attributes = True
    review_status: str = "approved"
    status: str = "published"

class EssayCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = ""
    excerpt: str | None = None
    images: list[str] = []


class EssayUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    excerpt: str | None = None
    images: list[str] | None = None