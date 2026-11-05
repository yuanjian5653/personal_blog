"""工具的请求 / 响应模型

约定与项目其它模块一致：Create 全是必填、Update 全部可选（PATCH 语义）、
Read 带 id 与时间戳。
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ToolKind = Literal["link", "page", "app"]


class ToolBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    # 留空则由后端生成 tool-{id}
    slug: str | None = Field(default=None, max_length=80)
    summary: str | None = Field(default=None, max_length=200)
    category: str = Field(default="其他", max_length=40)
    kind: ToolKind = "link"
    icon: str | None = Field(default=None, max_length=40)
    href: str = Field(..., min_length=1, max_length=500)
    tags: str | None = Field(default=None, max_length=200)
    sort_order: int = 0
    is_visible: bool = True


class ToolCreate(ToolBase):
    pass


class ToolUpdate(BaseModel):
    """全部可选：只改传入的字段"""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    slug: str | None = Field(default=None, max_length=80)
    summary: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=40)
    kind: ToolKind | None = None
    icon: str | None = Field(default=None, max_length=40)
    href: str | None = Field(default=None, min_length=1, max_length=500)
    tags: str | None = Field(default=None, max_length=200)
    sort_order: int | None = None
    is_visible: bool | None = None


class ToolRead(BaseModel):
    id: int
    slug: str
    name: str
    summary: str | None
    category: str
    kind: str
    icon: str | None
    href: str
    tags: str | None
    sort_order: int
    is_visible: bool
    click_count: int
    created_at: datetime
    updated_at: datetime


class ToolReorderItem(BaseModel):
    id: int
    sort_order: int
