"""工具的请求 / 响应模型

约定与项目其它模块一致：Create 全是必填、Update 全部可选（PATCH 语义）、
Read 带 id 与时间戳。

**两个响应模型是有意分开的**：
  ToolRead    列表用 —— 不含 description
  ToolDetail  详情用 —— 含 description
理由：几十条工具的 Markdown 正文加起来可能几十 KB，列表页完全用不到，
塞进列表响应只会拖慢首屏。列表接口返回 ToolRead，详情/编辑接口返回 ToolDetail。
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ToolKind = Literal["link", "page", "app"]

# 工具强调色的**预设白名单**（前端 components/tools/ToolForm.tsx 的
# TOOL_COLOR_OPTIONS 必须与这里保持一致的 key）。
#
# 为什么不让用户随便填 #ff0000 或者 CSS 片段：
#   1. 本站有玻璃 / 黑两套主题，自由色值很容易在某一套下看不清
#   2. 颜色最终会进 CSS 变量，白名单能从根上消除样式注入
TOOL_COLORS = (
    "default",  # 跟随主题强调色
    "amber",
    "mint",
    "sky",
    "violet",
    "rose",
    "cyan",
    "lime",
)


def normalize_tool_color(value: str | None) -> str | None:
    """校验并规范化配色名：不在白名单里就当成"未设置"。"""
    if not value:
        return None
    v = value.strip().lower()
    if v in ("", "default"):
        return None
    if v not in TOOL_COLORS:
        raise ValueError(f"不支持的配色：{value}")
    return v


class ToolBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    # 留空则由后端生成 tool-{id}
    slug: str | None = Field(default=None, max_length=80)
    summary: str | None = Field(default=None, max_length=200)
    category: str = Field(default="其他", max_length=40)
    kind: ToolKind = "link"
    icon: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, max_length=20)
    href: str = Field(..., min_length=1, max_length=500)
    tags: str | None = Field(default=None, max_length=200)
    sort_order: int = 0
    is_visible: bool = True
    # 详情页正文（Markdown），可选
    description: str | None = None


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
    color: str | None = Field(default=None, max_length=20)
    href: str | None = Field(default=None, min_length=1, max_length=500)
    tags: str | None = Field(default=None, max_length=200)
    sort_order: int | None = None
    is_visible: bool | None = None
    description: str | None = None


class ToolRead(BaseModel):
    """列表项（不含正文）"""

    id: int
    slug: str
    name: str
    summary: str | None
    category: str
    kind: str
    icon: str | None
    color: str | None
    href: str
    tags: str | None
    sort_order: int
    is_visible: bool
    click_count: int
    created_at: datetime
    updated_at: datetime


class ToolDetail(ToolRead):
    """详情项（含 Markdown 正文）"""

    description: str | None


class ToolReorderItem(BaseModel):
    id: int
    sort_order: int
