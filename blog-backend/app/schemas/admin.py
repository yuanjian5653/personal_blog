"""后台管理的请求/响应模型"""
from datetime import datetime

from pydantic import BaseModel, Field


# ============================================================
# 仪表盘看板
# ============================================================

class StatCard(BaseModel):
    """一个统计卡片"""
    key: str
    label: str
    value: int


class TrendPoint(BaseModel):
    """趋势图上的一个点"""
    date: str          # MM-DD
    value: int


class DistributionSlice(BaseModel):
    """环形图的一块"""
    name: str
    value: int


class DashboardStats(BaseModel):
    """仪表盘一次性返回所有看板数据"""
    cards: list[StatCard]
    article_trend: list[TrendPoint]
    visitor_trend: list[TrendPoint]
    category_distribution: list[DistributionSlice]
    browser_distribution: list[DistributionSlice]
    # 趋势区间的起始日期（前端显示用）
    range_start: str
    range_end: str


# ============================================================
# 评论管理
# ============================================================

class AdminReply(BaseModel):
    """后台里展示的一条回复"""
    id: int
    author_login: str
    author_name: str | None = None
    author_avatar: str | None = None
    author_html_url: str | None = None
    content: str
    ip: str | None = None
    status: str
    created_at: datetime


class AdminComment(BaseModel):
    """后台评论管理列表里的一行"""
    id: int
    target_type: str            # essay / life / article / guestbook
    target_id: int | None = None
    target_title: str           # 展示用：文章标题 / 说说摘要 / "留言板"
    author_login: str
    author_name: str | None = None
    author_avatar: str | None = None
    author_html_url: str | None = None
    content: str
    ip: str | None = None
    reply_count: int = 0
    status: str
    created_at: datetime
    replies: list[AdminReply] = []


class AdminCommentList(BaseModel):
    total: int
    page: int
    page_size: int
    comments: list[AdminComment]


class CommentStatusUpdate(BaseModel):
    """审核：切换为 approved / rejected"""
    status: str = Field(..., pattern="^(approved|rejected)$")


# ============================================================
# 访问埋点
# ============================================================

class TrackRequest(BaseModel):
    path: str = Field(..., max_length=300)
