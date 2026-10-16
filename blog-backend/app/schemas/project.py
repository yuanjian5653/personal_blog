"""项目的请求/响应模型"""
from datetime import datetime

from pydantic import BaseModel, Field


class ProjectRead(BaseModel):
    id: int
    full_name: str
    name: str
    title: str
    summary: str | None
    description: str | None
    html_url: str
    homepage: str | None
    language: str | None
    stars: int
    forks: int
    topics: list[str]
    license: str | None
    pushed_at: datetime | None
    is_visible: bool
    is_pinned: bool
    sort_order: int


class ProjectUpdate(BaseModel):
    """后台可改的字段（不含 GitHub 同步来的那些）"""
    is_visible: bool | None = None
    is_pinned: bool | None = None
    sort_order: int | None = None
    custom_title: str | None = Field(default=None, max_length=200)
    custom_description: str | None = Field(default=None, max_length=1000)


class ProjectSyncResult(BaseModel):
    """同步结果，给后台显示用了多少条"""
    total: int          # GitHub 上过滤后的仓库数
    created: int        # 新增
    updated: int        # 更新
    username: str
