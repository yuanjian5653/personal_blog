"""
项目（用于 /projects 页面）

数据有两个来源，故意分开存：
- **GitHub 同步来的**：star / 语言 / 最近推送等会变，每次同步覆盖，
  不需要人工维护。
- **人工设置的**：是否展示、排序、自定义描述与自定义标题 ——
  这些同步时**不能覆盖**，否则每次同步都把人的设置冲掉了。

所以这张表既是"仓库缓存"也是"展示配置"：
同步只写 gh_* 字段，后台编辑只写 is_visible / sort_order / 自定义字段。
"""
from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class Project(SQLModel, table=True):
    """一个 GitHub 仓库在站内的展示配置"""

    __tablename__ = "projects"

    id: int | None = Field(default=None, primary_key=True)

    # ---- 来自 GitHub 的字段（同步时覆盖）----
    # full_name 形如 "user/repo"，是唯一标识
    full_name: str = Field(max_length=200, unique=True, index=True)
    name: str = Field(max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    html_url: str = Field(max_length=500)
    homepage: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default=None, max_length=50, index=True)
    stars: int = Field(default=0, index=True)
    forks: int = Field(default=0)
    topics_json: str | None = Field(default=None, max_length=1000)
    license: str | None = Field(default=None, max_length=50)
    # 注意：SQLModel 不允许存 naive datetime（会报
    # "Datetime values must have timezone information"），
    # 所以这里统一存 **带时区的 UTC**，跟本项目其它时间字段一致。
    pushed_at: datetime | None = Field(default=None)

    # ---- 人工设置的字段（同步不覆盖）----
    is_visible: bool = Field(default=True, index=True)
    sort_order: int = Field(default=0)
    # 想自己写一段更好的介绍时填这里；为空则显示 GitHub 的 description
    custom_description: str | None = Field(default=None, max_length=1000)
    # 想在卡片上显示别的名字时填这里；为空则用仓库名
    custom_title: str | None = Field(default=None, max_length=200)
    # 置顶（置顶的永远排在前面，不受 star 数影响）
    is_pinned: bool = Field(default=False, index=True)

    synced_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @property
    def title(self) -> str:
        return self.custom_title or self.name

    @property
    def summary(self) -> str | None:
        return self.custom_description or self.description
