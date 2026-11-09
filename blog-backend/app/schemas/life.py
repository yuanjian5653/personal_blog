from datetime import datetime
from pydantic import BaseModel


class LifePostRead(BaseModel):
    id: int
    content: str
    images: list[str] = []
    location: str | None = None
    created_at: datetime
    # 点赞数（实时统计 essay_likes 行数，不存冗余字段）与"我是否赞过"
    likes: int = 0
    liked: bool = False
    # 内容作者（成员标签用）。列表接口只给 id，
    # 显示名和头像由前端通过 GET /api/authors 一次性取回后本地关联。
    author_id: int | None = None

    class Config:
        from_attributes = True


class LifePostCreate(BaseModel):
    content: str = ""
    images: list[str] = []
    location: str | None = None


class LifePostUpdate(BaseModel):
    content: str | None = None
    images: list[str] | None = None
    location: str | None = None