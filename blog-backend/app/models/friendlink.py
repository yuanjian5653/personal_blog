"""
友情链接

字段覆盖"网址 / 名称 / 类型 / 简介 / 封面 / 权重"六项。
权重用于前台排序与视觉强调：权重越大，卡片越大、越靠前。
"""
from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class FriendLink(SQLModel, table=True):
    """一条友链"""

    __tablename__ = "friend_links"

    id: int | None = Field(default=None, primary_key=True)

    # ---- 基本信息 ----
    name: str = Field(max_length=100, index=True)          # 站点名称
    url: str = Field(max_length=500)                        # 网址
    # 类型：例如 "技术" / "设计" / "生活"，用于前台分组与配色
    category: str | None = Field(default=None, max_length=50, index=True)
    description: str | None = Field(default=None, max_length=500)  # 简介
    cover: str | None = Field(default=None, max_length=500)        # 封面图（相对路径或完整 URL）

    # ---- 权重 ----
    # 越大越"重要"：前台卡片更大、更靠前。
    # 给一个合理默认值，避免忘填时全部挤在一起。
    weight: int = Field(default=0, index=True)

    # 是否展示（留个开关，不想删又不显示的可以关掉）
    is_visible: bool = Field(default=True, index=True)

    # 排序用：同权重时按这个（越小越前），方便手动微调
    sort_order: int = Field(default=0)

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
