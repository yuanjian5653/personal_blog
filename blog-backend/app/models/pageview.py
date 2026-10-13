"""
访问统计（用于后台仪表盘的"访客趋势 / 浏览器分布"）

一次页面访问记一行。为了在"够用"和"省空间"之间取平衡：
- 只记必要字段，不存完整 UA（只存解析后的浏览器名）
- visitor_hash 用 IP + UA + 当日日期 做哈希：
  · 同一个人同一天多次访问算一个访客
  · 不存原始 IP 的哈希无法跨天追踪（也算隐私上更克制）
- ip 单独存一份明文，便于后台排查异常（与截图里的 IP 列一致）
"""
from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class PageView(SQLModel, table=True):
    """一次页面访问"""

    __tablename__ = "page_views"

    id: int | None = Field(default=None, primary_key=True)

    # 访问路径（不含查询串，避免把参数写进来）
    path: str = Field(max_length=300, index=True)

    # 去过重后的访客标识（按天，见模块说明）
    visitor_hash: str = Field(max_length=64, index=True)

    ip: str | None = Field(default=None, max_length=64)

    # 解析后的浏览器名（Chrome / Safari / Edge / Firefox ...）
    browser: str = Field(default="Unknown", max_length=40, index=True)

    # 是否为登录后的访客（保留字段，方便以后区分）
    is_login: bool = Field(default=False)

    created_at: datetime = Field(default_factory=utcnow, index=True)
