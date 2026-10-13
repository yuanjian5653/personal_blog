"""评论相关的请求/响应模型"""
from datetime import datetime

from pydantic import BaseModel, Field

# 单条评论最大长度。与 settings.COMMENT_MAX_LENGTH 是同一个约定，
# 但这里写成常量，避免 schema 依赖 .env（schema 是纯数据结构）。
COMMENT_MAX_LENGTH = 2000


class CommenterInfo(BaseModel):
    """当前登录的访客信息（返回给前端）"""
    id: int
    login: str
    name: str | None = None
    avatar_url: str | None = None
    html_url: str | None = None


class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=COMMENT_MAX_LENGTH)
    # 回复某条顶层评论时传它的 id；顶层评论传 None
    parent_id: int | None = None


class CommentRead(BaseModel):
    """单条评论"""
    id: int
    # 目标：说说 / 生活动态 / 文章（三选一）或留言板（全为空）
    essay_id: int | None = None
    life_post_id: int | None = None
    article_id: int | None = None
    # "essay" | "life" | "article" | "guestbook"，方便前端判断
    target_type: str
    parent_id: int | None = None
    content: str
    author_login: str
    author_name: str | None = None
    author_avatar: str | None = None
    author_html_url: str | None = None
    likes: int = 0
    # 当前登录用户是否已点赞（未登录恒为 false）
    liked: bool = False
    # 是否本人发的（前端据此决定是否显示删除按钮）
    mine: bool = False
    # 审核状态：approved / rejected
    status: str = "approved"
    created_at: datetime
    replies: list["CommentRead"] = []


class CommentListResponse(BaseModel):
    """某条说说的评论列表 + 当前登录态"""
    total: int
    comments: list[CommentRead]
    # 当前访客（未登录为 None）
    viewer: CommenterInfo | None = None


class LikeResponse(BaseModel):
    """点赞/取消点赞评论的结果"""
    likes: int
    liked: bool


class EssayLikesResponse(BaseModel):
    """说说的点赞数与当前用户是否已赞"""
    likes: int
    liked: bool


# 让 CommentRead.replies 的自引用生效
CommentRead.model_rebuild()
