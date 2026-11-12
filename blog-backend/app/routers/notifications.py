"""后台 · 通知队列查看与重试"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.deps import get_current_admin
from datetime import timedelta

from app.models import Admin, NotificationOutbox, Subscriber
from app.schemas.notification import BroadcastResult, SiteUpdateBroadcastRequest
from app.services import mailer, notifier

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


@router.get("/status")
def notification_status(
    _admin: Admin = Depends(get_current_admin),
):
    """通知功能的前置条件检查。

    为什么要这个：邮件没配时，点「发布公告」只会得到一句 400，
    用户得回头翻代码才知道缺哪个环境变量。这里提前摊开说清楚。
    """
    from app.services import mailer

    missing: list[str] = []
    if not (settings.MAIL_FROM or "").strip():
        missing.append("MAIL_FROM（发件邮箱）")
    if not (settings.MAIL_PASSWORD or "").strip():
        missing.append("MAIL_PASSWORD（SMTP 密码/授权码）")

    return {
        "mail_configured": mailer.mail_configured(),
        "missing": missing,
        "mail_host": settings.MAIL_HOST,
        "mail_port": settings.MAIL_PORT,
        "site_url": settings.SITE_URL,
        "site_url_is_local": (settings.SITE_URL or "").startswith(
            ("http://localhost", "http://127.0.0.1")
        ),
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


@router.post("/broadcast", response_model=BroadcastResult)
def broadcast_site_update(
    payload: SiteUpdateBroadcastRequest,
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """手动发一条「网站更新」公告给所有已确认订阅者。

    为什么不跟部署挂钩（每次部署自动通知）：
        改个 CSS、修个错别字都算一次部署。自动通知会让订阅者收到一堆
        "网站更新了"，很快就全退订。所以只做**手动**触发，
        由你在真的有值得说的变化时点一下。

    防重复提交：同标题 60 秒内只接受一次（`immediate` 时尤其容易手抖）。
    """
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    recent = db.exec(
        select(NotificationOutbox).where(
            NotificationOutbox.event_type == "site.update",
            NotificationOutbox.title == title,
            NotificationOutbox.created_at
            >= datetime.now(timezone.utc) - timedelta(seconds=60),
        )
    ).first()

    if recent is not None:
        raise HTTPException(status_code=409, detail="一分钟内已经发过同标题的公告")

    confirmed = db.exec(
        select(Subscriber.id).where(Subscriber.status == "confirmed")
    ).all()

    if not mailer.mail_configured():
        raise HTTPException(
            status_code=400,
            detail="邮件功能未配置（MAIL_FROM / MAIL_PASSWORD 为空），发不出去",
        )

    ok = notifier.enqueue_site_update(
        title,
        (payload.summary or "").strip() or None,
        payload.path or "/",
        immediate=payload.immediate,
    )
    if not ok:
        raise HTTPException(status_code=500, detail="入队失败，请查看后端日志")

    # 入队后立刻查回来，把 id 返回给前端
    row = db.exec(
        select(NotificationOutbox)
        .where(NotificationOutbox.event_type == "site.update")
        .order_by(NotificationOutbox.id.desc())
        .limit(1)
    ).first()
    row_obj = row[0] if row is not None and not isinstance(row, NotificationOutbox) else row

    n = len(confirmed)
    logger.info("[通知] 管理员发布网站更新公告：%s（订阅者 %d 位）", title, n)
    return BroadcastResult(
        ok=True,
        message=(
            f"已入队，将发送给 {n} 位已确认订阅者"
            if n
            else "已入队，但当前没有已确认订阅者（这条会被直接标记为已发送）"
        ),
        notification_id=getattr(row_obj, "id", None),
    )


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
