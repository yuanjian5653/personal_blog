"""
站内回复通知路由

    GET  /api/notifications               列表 + 未读数
    GET  /api/notifications/unread-count  只取未读数（红点轮询用，很轻）
    POST /api/notifications/read          标为已读（传 ids 或全部）

全部需要普通访客登录（GitHub）。未登录返回 401，前端据此不显示红点。

`require_commenter` 定义在 comments.py 里（评论体系自己的登录态），
这里直接复用 —— 反向依赖是单向的，不会造成循环导入。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, func, select

from app.database import get_session
from app.db_utils import model as _unwrap
from app.models import Commenter, ReplyNotification
from app.routers.comments import require_commenter
from app.schemas.reply_notification import (
    MarkReadRequest,
    ReplyNotificationList,
    ReplyNotificationRead,
    UnreadCount,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["站内通知"])



def _count_unread(db: Session, commenter_id: int) -> int:
    row = db.exec(
        select(func.count())
        .select_from(ReplyNotification)
        .where(
            ReplyNotification.commenter_id == commenter_id,
            ReplyNotification.is_read == False,  # noqa: E712
        )
    ).first()
    if row is None:
        return 0
    # 聚合查询的返回形态不稳定：有时是 Row((1,))，有时直接是标量 1。
    # 两种都要吃得下，否则会静默返回 0（红点永远不出现）。
    try:
        value = row[0]
    except (TypeError, IndexError, KeyError):
        value = row
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


@router.get("", response_model=ReplyNotificationList)
def list_notifications(
    limit: int = 50,
    db: Session = Depends(get_session),
    me: Commenter = Depends(require_commenter),
):
    """当前登录者的通知列表，新的在前。

    `limit` 用普通默认值而不是 `Query(...)`：本项目的测试习惯**直接调用
    路由函数**（参见 test_comments.py），而 Query(...) 的默认值只有在
    经过 FastAPI 解析时才会变成 int，直接调用会拿到 Query 对象，
    `.limit(Query)` 会抛 TypeError。范围在这里手动夹住。
    """
    limit = max(1, min(200, limit))

    rows = db.exec(
        select(ReplyNotification)
        .where(ReplyNotification.commenter_id == me.id)
        .order_by(ReplyNotification.created_at.desc(), ReplyNotification.id.desc())
        .limit(limit)
    ).all()

    items = []
    for r in rows:
        obj = _unwrap(r)
        if isinstance(obj, ReplyNotification):
            items.append(obj)

    return ReplyNotificationList(
        items=[ReplyNotificationRead.model_validate(i) for i in items],
        unread_count=_count_unread(db, me.id or 0),
    )


@router.get("/unread-count", response_model=UnreadCount)
def get_unread_count(
    db: Session = Depends(get_session),
    me: Commenter = Depends(require_commenter),
):
    """红点轮询用。

    单独做一个很轻的接口：导航栏每 60 秒问一次，
    不应该为了一个数字去拉整个列表。
    """
    return UnreadCount(count=_count_unread(db, me.id or 0))


@router.post("/read", response_model=UnreadCount)
def mark_read(
    payload: MarkReadRequest | None = None,
    db: Session = Depends(get_session),
    me: Commenter = Depends(require_commenter),
):
    """标为已读。不传 ids 就把自己的全部标为已读。"""
    ids = (payload.ids if payload else None) or []

    stmt = select(ReplyNotification).where(
        ReplyNotification.commenter_id == me.id,
        ReplyNotification.is_read == False,  # noqa: E712
    )
    if ids:
        stmt = stmt.where(ReplyNotification.id.in_(ids))

    rows = db.exec(stmt).all()
    changed = 0
    for r in rows:
        obj = _unwrap(r)
        if isinstance(obj, ReplyNotification):
            obj.is_read = True
            db.add(obj)
            changed += 1
    if changed:
        db.commit()
        logger.info("[通知] %s 标记 %d 条已读", me.login, changed)

    return UnreadCount(count=_count_unread(db, me.id or 0))
