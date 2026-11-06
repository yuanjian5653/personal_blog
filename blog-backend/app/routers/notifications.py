"""后台 · 通知队列查看与重试"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, NotificationOutbox
from app.services import mailer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/notifications", tags=["通知管理"])


def _to_dict(row: NotificationOutbox) -> dict:
    return {
        "id": row.id,
        "event_type": row.event_type,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "title": row.title,
        "summary": row.summary,
        "url": row.url,
        "status": row.status,
        "scheduled_at": row.scheduled_at,
        "attempts": row.attempts,
        "last_error": row.last_error,
        "sent_count": row.sent_count,
        "sent_at": row.sent_at,
        "created_at": row.created_at,
    }


@router.get("")
def list_notifications(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """后台看队列：最近 100 条 + 各状态计数"""
    rows = db.exec(
        select(NotificationOutbox).order_by(NotificationOutbox.id.desc()).limit(100)
    ).all()
    items = [r for r in rows if isinstance(r, NotificationOutbox)]

    counts = {"pending": 0, "sending": 0, "sent": 0, "failed": 0}
    for r in items:
        if r.status in counts:
            counts[r.status] += 1

    return {
        "counts": counts,
        "items": [_to_dict(r) for r in items],
        "mail_configured": mailer.mail_configured(),
    }


@router.post("/{notification_id}/retry")
def retry_notification(
    notification_id: int,
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """把失败的通知放回队列，下一轮就会再发"""
    row = db.get(NotificationOutbox, notification_id)
    if row is None:
        raise HTTPException(status_code=404, detail="通知不存在")
    if row.status == "sent":
        raise HTTPException(status_code=400, detail="这条已经发过了")

    row.status = "pending"
    row.attempts = 0
    row.last_error = None
    row.scheduled_at = datetime.now(timezone.utc)
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    logger.info("[通知] 管理员手动重试 #%s", notification_id)
    return {"message": "已放回队列"}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    row = db.get(NotificationOutbox, notification_id)
    if row is None:
        raise HTTPException(status_code=404, detail="通知不存在")
    db.delete(row)
    db.commit()
    return {"message": "已删除"}
