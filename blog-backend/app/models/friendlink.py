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

    # 内容作者（阶段 1：多成员共用一套后台，靠它区分归属）
    # NULL = 迁移前的历史数据，展示时按站长处理
    author_id: int | None = Field(default=None, foreign_key="admin.id", index=True)

    # 审核状态：none/approved 视为已通过；pending 待审；rejected 驳回
    # 历史数据迁移时统一置为 approved —— 线上表现不变，只有之后成员新提交的才进审核
    review_status: str = Field(default="approved", max_length=20, index=True)

    # 审核意见（驳回理由）。通过时清空。成员在后台能看到这一句。
    review_note: str | None = Field(default=None, max_length=500)

    # 是否对公众可见（与 review_status 正交：草稿/待审/已发布是两条轴）
    status: str = Field(default="published", max_length=20, index=True)

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
