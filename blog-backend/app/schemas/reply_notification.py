"""站内回复通知的请求/响应模型"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ReplyNotificationRead(BaseModel):
    """一条通知。给前端渲染红点列表用。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    comment_id: int
    parent_comment_id: int | None
    target_type: str
    target_id: int | None
    link: str
    preview: str
    actor_login: str
    actor_name: str | None
    actor_avatar: str | None
    is_read: bool
    created_at: datetime


class ReplyNotificationList(BaseModel):
    items: list[ReplyNotificationRead]
    unread_count: int


class UnreadCount(BaseModel):
    count: int


class MarkReadRequest(BaseModel):
    """不传 ids 表示"全部标为已读"。"""

    ids: list[int] | None = None
