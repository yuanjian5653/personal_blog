"""
成员自定义主题。

背景：主题（配色、背景、首页卡片样式）原来只存在 site_config 里，
只有管理员能改，前台永远显示站长那一套。

现在每个账号可以有自己的一套，由管理员决定是否"上线"：
  · 未上线 → 只有作者自己在后台看得到
  · 已上线 → 出现在前台的主题切换器里，访客可以切过去

站长的 site_config 仍然是默认主题，不需要在这里再存一份。
"""
from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._base import utcnow


class MemberTheme(SQLModel, table=True):
    """一个账号一套主题（admin_id 唯一）。"""

    __tablename__ = "member_themes"

    id: int | None = Field(default=None, primary_key=True)
    admin_id: int = Field(foreign_key="admin.id", unique=True, index=True)

    # 显示在切换器里的名字（比如"星空紫"）
    name: str = Field(default="我的主题", max_length=50)

    # ---- 主题与背景 ----
    theme_accent: str = Field(default="#7c5cff", max_length=20)
    bg_type: str = Field(default="color", max_length=20)  # color | image
    bg_color: str = Field(default="#0f1115", max_length=20)
    bg_image: str = Field(default="", max_length=500)
    bg_blur: int = Field(default=0)
    bg_overlay: float = Field(default=0.0)
    card_style: str = Field(default="glass", max_length=20)  # glass | black

    # ---- 首页卡片 ----
    card_text: str = Field(default="", max_length=2000)
    card_wave_color1: str = Field(default="#7c5cff", max_length=20)
    card_wave_color2: str = Field(default="#4cc9f0", max_length=20)
    home_album_id: int | None = Field(default=None)

    # ---- 是否上线（管理员控制）----
    is_published: bool = Field(default=False, index=True)

    updated_at: datetime = Field(default_factory=utcnow)
