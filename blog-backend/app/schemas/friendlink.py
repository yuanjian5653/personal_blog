"""友情链接的请求/响应模型"""
from datetime import datetime

from pydantic import BaseModel, Field


class FriendLinkBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=500)
    cover: str | None = Field(default=None, max_length=500)
    # 权重可正可负：负值表示"往下压"，方便把不太重要的排到后面
    weight: int = 0
    is_visible: bool = True
    sort_order: int = 0


class FriendLinkCreate(FriendLinkBase):
    pass


class FriendLinkUpdate(BaseModel):
    """全部可选，支持只改一个字段（PATCH 语义）"""
    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: str | None = Field(default=None, min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=500)
    cover: str | None = Field(default=None, max_length=500)
    weight: int | None = None
    is_visible: bool | None = None
    sort_order: int | None = None


class FriendLinkRead(FriendLinkBase):
    id: int
    created_at: datetime
    updated_at: datetime
