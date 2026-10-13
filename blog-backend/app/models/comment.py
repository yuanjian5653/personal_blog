"""
评论系统模型

四张表：
- commenters      ：通过 GitHub 登录的访客（与管理员 admin 表分开，互不影响）
- commenter_sessions：访客登录态
- comments        ：评论，支持一级回复（parent_id 指向同表的顶层评论）
- comment_likes   ：评论点赞，用 (comment_id, commenter_id) 唯一约束防重复
- essay_likes     ：目标点赞（说说等），表名是历史原因

评论的目标（target）：
- essay    → comments.essay_id
- life     → comments.life_post_id
- article  → comments.article_id
- guestbook→ 三个都为空（留言板本身没有内容实体）
"""
from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class Commenter(SQLModel, table=True):
    """GitHub 登录的访客"""

    __tablename__ = "commenters"

    id: int | None = Field(default=None, primary_key=True)

    # GitHub 用户 id，用作唯一标识（改用户名也不会变成另一个人）
    github_id: int = Field(unique=True, index=True)
    login: str = Field(max_length=100, index=True)          # 用户名，如 "octocat"
    name: str | None = Field(default=None, max_length=200)  # 昵称（可能为空）
    avatar_url: str | None = Field(default=None, max_length=500)
    html_url: str | None = Field(default=None, max_length=500)

    created_at: datetime = Field(default_factory=utcnow)
    last_login_at: datetime = Field(default_factory=utcnow)


class CommenterSession(SQLModel, table=True):
    """访客登录态（与管理员 session 分开存）"""

    __tablename__ = "commenter_sessions"

    id: int | None = Field(default=None, primary_key=True)
    commenter_id: int = Field(foreign_key="commenters.id", index=True)
    session_token: str = Field(unique=True, index=True, max_length=128)
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=utcnow)


class Comment(SQLModel, table=True):
    """评论

    可以挂在三种目标上：
    - essay_id     ：说说（essays.id）
    - life_post_id ：生活动态（life_posts.id）
    - article_id   ：文章（articles.id）

    另有第四种"杂谈/留言板"：**三个字段全为 NULL** 即表示留言板。
    留言板没有自己的内容实体，它本身就是一堆评论，所以不需要额外的表。

    用"多个可空外键"而不是 (target_type, target_id) 多态设计，
    这样外键约束依然有效，删除目标时不会留下孤儿评论。
    """

    __tablename__ = "comments"

    id: int | None = Field(default=None, primary_key=True)

    # 关联目标（三选一；全为 NULL = 留言板）
    essay_id: int | None = Field(default=None, foreign_key="essays.id", index=True)
    life_post_id: int | None = Field(
        default=None, foreign_key="life_posts.id", index=True
    )
    article_id: int | None = Field(default=None, foreign_key="articles.id", index=True)
    commenter_id: int = Field(foreign_key="commenters.id", index=True)

    # 一级回复：指向同表中某条顶层评论；顶层评论为 None
    parent_id: int | None = Field(default=None, foreign_key="comments.id", index=True)

    content: str = Field(max_length=2000)

    # 冗余一份作者信息，避免列表查询时 N+1
    author_login: str = Field(max_length=100)
    author_name: str | None = Field(default=None, max_length=200)
    author_avatar: str | None = Field(default=None, max_length=500)

    # 发表时的来源 IP（后台评论管理里展示，便于排查）
    ip: str | None = Field(default=None, max_length=64)

    # 审核状态：
    #   approved = 正常显示（默认）
    #   rejected = 被后台拒绝（前端不再展示，但记录保留）
    status: str = Field(default="approved", max_length=20, index=True)

    created_at: datetime = Field(default_factory=utcnow, index=True)


class CommentLike(SQLModel, table=True):
    """评论点赞记录，用于去重与取消点赞"""

    __tablename__ = "comment_likes"
    # 数据库层唯一约束：并发点两次也不会写入两条
    __table_args__ = (
        UniqueConstraint("comment_id", "commenter_id", name="uq_comment_like"),
    )

    id: int | None = Field(default=None, primary_key=True)
    comment_id: int = Field(foreign_key="comments.id", index=True)
    commenter_id: int = Field(foreign_key="commenters.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)


class EssayLike(SQLModel, table=True):
    """点赞记录（登录用户，一人一次，可取消）

    和 Comment 一样支持两种目标：说说 / 生活动态。
    表名沿用 essay_likes（历史原因），但已经是通用的目标点赞表。
    """

    __tablename__ = "essay_likes"
    # 唯一约束按目标分别建立（见迁移脚本 / 初始化说明）
    __table_args__ = (
        UniqueConstraint("essay_id", "commenter_id", name="uq_essay_like"),
    )

    id: int | None = Field(default=None, primary_key=True)
    essay_id: int | None = Field(default=None, foreign_key="essays.id", index=True)
    life_post_id: int | None = Field(
        default=None, foreign_key="life_posts.id", index=True
    )
    commenter_id: int = Field(foreign_key="commenters.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)
