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


class HeatmapDay(BaseModel):
    """热力图上的一天"""

    date: str          # YYYY-MM-DD
    views: int         # 页面访问数
    posts: int         # 新增内容（文章 + 随笔 + 动态）
    comments: int      # 新增评论


class PageStat(BaseModel):
    """一个页面的访问量（用于热门页面排行）"""

    path: str
    value: int


class HourPoint(BaseModel):
    """某个小时的访问量"""

    hour: int          # 0-23
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

    # ---- 以下为第二批图表 ----
    # 活动热力图：近 365 天，按**北京时间**分桶（见路由里的说明）
    heatmap: list[HeatmapDay] = []
    # 热门页面 Top N（近 30 天，按访问次数）
    top_pages: list[PageStat] = []
    # 访问时段分布：24 小时（近 30 天，北京时间）
    hour_distribution: list[HourPoint] = []


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
