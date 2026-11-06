"""
站内回复通知（红点）

为什么只能是站内的：
    `Commenter` 表里**没有邮箱字段**（只有 github_id / login / name /
    avatar_url / html_url），GitHub OAuth 拿到的也是 noreply 地址，
    发不出去也不该发。所以"有人回复了你的评论"只能靠站内红点告知。

为什么通知对象是「顶层父评论的作者」：
    评论是一级扁平结构 —— 回复一条回复时，后端会把它重新挂到顶层父评论上
    （见 comments._add_comment 里 `if parent.parent_id: parent_id = parent.parent_id`）。
    所以一条回复的 parent 永远是顶层评论，收件人就是它的作者。

    副作用：A 发顶层评论，B 和 C 互相回复，通知都会给 A，不会给 B/C。
    这是扁平结构带来的固有限制，先接受；要精确到"回复了谁"就得改成多层
    或额外存 reply_to_commenter_id。
"""
from datetime import datetime

from sqlalchemy import Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel

from app.models._base import utcnow


class ReplyNotification(SQLModel, table=True):
    """一条"你的评论被回复了"的通知

    外键的删除行为是刻意选的（不加 CASCADE 会挡住删评论）：
      · commenter_id      → CASCADE   人没了，通知也没意义
      · comment_id        → CASCADE   这条回复被删了，通知就该消失
      · parent_comment_id → SET NULL  父评论没了不该连累通知本身
    """

    __tablename__ = "reply_notifications"

    id: int | None = Field(default=None, primary_key=True)

    # 收件人（被回复那条评论的作者）
    commenter_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("commenters.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )

    # 触发通知的那条回复。
    # unique：一条回复只应产生一条通知 —— 并发/重试下都能保证幂等。
    comment_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("comments.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        )
    )

    # 被回复的那条（顶层父评论）
    parent_comment_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("comments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # 目标信息。冗余存一份，避免每次列表都要联表算链接
    target_type: str = Field(max_length=20)  # article / essay / life / guestbook
    target_id: int | None = Field(default=None)
    # 前端可点的路径，创建时就固定下来（如 /articles/xxx）
    link: str = Field(max_length=500)

    # 回复内容摘要（截前 120 字）。同样冗余存：
    # 原评论被删除后，通知里仍然显示得出"他回复了什么"
    preview: str = Field(max_length=200)

    # 回复者信息（显示头像和名字，不用再联 commenters）
    actor_login: str = Field(max_length=100)
    actor_name: str | None = Field(default=None, max_length=200)
    actor_avatar: str | None = Field(default=None, max_length=500)

    is_read: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)
