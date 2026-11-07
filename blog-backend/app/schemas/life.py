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