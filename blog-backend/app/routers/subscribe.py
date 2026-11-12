"""
邮件订阅路由

公开接口：
  POST /api/subscribe                   提交邮箱 → 发确认邮件（double opt-in）
  GET  /api/subscribe/confirm?token=    确认订阅（返回 HTML 页面）
  GET  /api/subscribe/unsubscribe?token= 退订（HTML 页面）
  POST /api/subscribe/unsubscribe?token= 一键退订（RFC 8058 List-Unsubscribe-Post）

后台接口（需管理员）：
  GET    /api/admin/subscribers              列表 + 统计
  DELETE /api/admin/subscribers/{id}         删除
  POST   /api/admin/subscribers/{id}/resend  重发确认信

三个刻意的决定：

1. **不泄露邮箱是否已订阅**
   POST /api/subscribe 永远返回同一句话。否则这个接口会变成
   "某人是否订阅了你的博客"的探测器。

2. **确认与退订用不同 token**
   确认链接常被截图转发，退订 token 必须独立，
   否则拿到确认链接的人也能替别人退订。

3. **发信失败不返回 500**
   用户看到"邮件已发送"就够了，细节进日志。否则配置错误会直接暴露在公网。
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select

from app.config import settings
from app.models._base import utcnow
from app.database import get_session
from app.net_utils import client_ip
from app.deps import get_current_admin
from app.models import Admin, Subscriber
from app.schemas.subscriber import SubscriberRead, SubscriberStats, SubscribeRequest
from app.services import mailer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/subscribe", tags=["订阅"])
admin_router = APIRouter(prefix="/api/admin/subscribers", tags=["订阅管理"])

GENERIC_OK = "如果这个邮箱有效，确认邮件已经发出，请查收（也看一下垃圾邮件箱）。"

# AnyVal: 所有对外话术统一，避免任何分支泄露"这个邮箱是否存在"
GENERIC_FAIL = "提交失败，请稍后再试。"


# ============================================================
# 工具
# ============================================================




def _hash_ip(ip: str | None) -> str | None:
    """只存哈希，不存明文 IP（最小必要原则）。"""
    if not ip:
        return None
    return hashlib.sha256(f"sub|{ip}".encode()).hexdigest()[:32]


def _confirm_url(token: str) -> str:
    return f"{settings.SITE_URL}/api/subscribe/confirm?token={token}"


def _unsubscribe_url(token: str) -> str:
    return f"{settings.SITE_URL}/api/subscribe/unsubscribe?token={token}"


async def _send_confirm_email(db: Session, sub: Subscriber) -> tuple[bool, str | None]:
    """发确认信并记录发送时间。

    注意：这个函数必须是 async —— 调用方 `subscribe` 是 async def，
    在事件循环里跑；如果这里用 asyncio.run() 会直接抛
    "asyncio.run() cannot be called from a running event loop"。
    """
    subject, text, html = mailer.render_confirm_email(
        _confirm_url(sub.confirm_token), _unsubscribe_url(sub.unsubscribe_token)
    )

    if mailer.mail_configured():
        ok, err = await mailer.try_send_mail(
            sub.email, subject, text, html, _unsubscribe_url(sub.unsubscribe_token)
        )
    else:
        ok, err = False, "邮件功能未配置（MAIL_FROM / MAIL_PASSWORD 为空）"

    sub.last_notified_at = utcnow()
    db.add(sub)
    db.commit()
    return ok, err


def _page(title: str, body_html: str, ok: bool = True) -> HTMLResponse:
    """极简结果页：不依赖前端 JS，点开链接就能看到结果。"""
    color = "#16a34a" if ok else "#dc2626"
    mark = "✓" if ok else "!"
    html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;
  justify-content:center;background:#0f1115;color:#e8e8ea;
  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:420px;padding:36px 30px;text-align:center;border-radius:16px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);">
    <div style="width:44px;height:44px;margin:0 auto 16px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:22px;
      background:{color}22;color:{color};">{mark}</div>
    <h1 style="margin:0 0 10px;font-size:17px;">{title}</h1>
    <div style="margin:0;font-size:13px;line-height:1.8;color:#9aa0aa;">{body_html}</div>
    <p style="margin:22px 0 0;">
      <a href="{settings.SITE_URL}/" style="display:inline-block;padding:8px 20px;
        border-radius:999px;background:#cac36d;color:#1f2937;text-decoration:none;
        font-size:13px;font-weight:600;">回到首页</a>
    </p>
  </div>
</body></html>"""
    return HTMLResponse(html, status_code=200 if ok else 400)


# ============================================================
# 公开接口
# ============================================================

@router.post("")
async def subscribe(
    payload: SubscribeRequest,
    request: Request,
    db: Session = Depends(get_session),
):
    """提交邮箱，发送确认邮件。无论邮箱是否已存在，返回话术都一样。"""
    email = payload.email
    source = (payload.source or "").strip()[:40] or None
    ip_hash = _hash_ip(client_ip(request))
    now = utcnow()

    # ---- IP 冷却：同一 IP 短时间内只处理一次 ----
    #
    # 阈值 <= 0 表示关闭。**必须显式判断**，不能只靠 `created_at >= since`
    # 自然成立为假 —— MySQL 的 DATETIME 没有小数秒，插入时会把毫秒
    # **四舍五入**，于是刚写入的记录读数可能"比 now 还晚"，
    # 冷却窗口为 0 时也会误判命中，把请求静默拦掉（本地就是这么踩到的）。
    if ip_hash and settings.SUBSCRIBE_IP_COOLDOWN > 0:
        since = now - timedelta(seconds=settings.SUBSCRIBE_IP_COOLDOWN)
        recent = db.exec(
            select(Subscriber.id).where(
                Subscriber.ip_hash == ip_hash, Subscriber.created_at >= since
            )
        ).first()
        if recent is not None:
            logger.info("[订阅] IP 冷却中，忽略本次提交")
            return {"ok": True, "message": GENERIC_OK}

    existing = db.exec(select(Subscriber).where(Subscriber.email == email)).first()

    if existing is not None:
        # 已确认：不重发（否则这个接口就成了给别人发骚扰邮件的工具）
        if existing.status == "confirmed":
            logger.info("[订阅] %s 已确认，不重发", email)
            return {"ok": True, "message": GENERIC_OK}

        # 未确认 / 已退订：允许重发，但受冷却限制（<=0 表示不限）
        if (
            existing.last_notified_at is not None
            and settings.SUBSCRIBE_RESEND_COOLDOWN > 0
        ):
            since = now - timedelta(seconds=settings.SUBSCRIBE_RESEND_COOLDOWN)
            if existing.last_notified_at >= since:
                logger.info("[订阅] %s 冷却中，不重发", email)
                return {"ok": True, "message": GENERIC_OK}

        # 重新订阅：换一套新 token（旧的确认链接随之失效）
        existing.confirm_token = secrets.token_urlsafe(32)
        existing.unsubscribe_token = secrets.token_urlsafe(32)
        existing.status = "pending"
        existing.unsubscribed_at = None
        existing.source = source or existing.source
        existing.ip_hash = ip_hash or existing.ip_hash
        db.add(existing)
        db.commit()
        db.refresh(existing)

        ok, err = await _send_confirm_email(db, existing)
        if not ok:
            logger.warning("[订阅] 确认信发送失败：%s", err)
        return {"ok": True, "message": GENERIC_OK}

    # ---- 新订阅者 ----
    sub = Subscriber(
        email=email,
        status="pending",
        confirm_token=secrets.token_urlsafe(32),
        unsubscribe_token=secrets.token_urlsafe(32),
        source=source,
        ip_hash=ip_hash,
        created_at=now,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    ok, err = await _send_confirm_email(db, sub)
    if not ok:
        logger.warning("[订阅] 确认信发送失败：%s", err)

    return {"ok": True, "message": GENERIC_OK}


@router.get("/confirm", response_class=HTMLResponse)
def confirm(
    token: str = Query(default="", max_length=64),
    db: Session = Depends(get_session),
):
    """点邮件里的链接确认订阅"""
    if not token:
        return _page("链接无效", "缺少确认参数，请重新从邮件里点一次。", ok=False)

    sub = db.exec(select(Subscriber).where(Subscriber.confirm_token == token)).first()
    if sub is None:
        return _page(
            "链接无效",
            "这个确认链接不存在或已失效（重新订阅会生成新链接）。",
            ok=False,
        )

    if sub.status == "confirmed":
        return _page("已经确认过了", f"{sub.email} 已经是订阅状态，不用重复确认。")

    sub.status = "confirmed"
    sub.confirmed_at = utcnow()
    sub.unsubscribed_at = None
    db.add(sub)
    db.commit()

    logger.info("[订阅] %s 确认成功", sub.email)
    return _page(
        "订阅成功",
        f"之后本站发布新内容时会通知 <b>{sub.email}</b>。<br />"
        "随时可以通过邮件底部的退订链接取消。",
    )


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(
    token: str = Query(default="", max_length=64),
    db: Session = Depends(get_session),
):
    """退订（邮件里的链接 / 邮件客户端的"一键退订"都会落到这里）"""
    if not token:
        return _page("链接无效", "缺少退订参数。", ok=False)

    sub = db.exec(
        select(Subscriber).where(Subscriber.unsubscribe_token == token)
    ).first()
    if sub is None:
        return _page("链接无效", "这个退订链接不存在或已失效。", ok=False)

    if sub.status == "unsubscribed":
        return _page("已经退订了", f"{sub.email} 已经在退订状态，不会再收到通知。")

    sub.status = "unsubscribed"
    sub.unsubscribed_at = utcnow()
    db.add(sub)
    db.commit()

    logger.info("[订阅] %s 已退订", sub.email)
    return _page(
        "已退订",
        f"{sub.email} 将不再收到本站的通知邮件。<br />想重新订阅随时可以再来。",
    )


@router.post("/unsubscribe", response_class=HTMLResponse, include_in_schema=False)
def unsubscribe_post(
    token: str = Query(default="", max_length=64),
    db: Session = Depends(get_session),
):
    """RFC 8058 的一键退订用 POST，复用同一份逻辑。"""
    return unsubscribe(token=token, db=db)


# ============================================================
# 后台接口
# ============================================================

@admin_router.get("")
def list_subscribers(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
    status: str | None = Query(default=None),
):
    """后台列表 + 统计。

    注意：**统计基于全部记录**，列表才按 status 过滤 ——
    否则筛了 pending 之后 confirmed 的数量会变成 0，看着像数据丢了。
    """
    # exec() 返回的是 Row，需要解包成模型（见 notifier._model 的说明）
    raw_rows = db.exec(select(Subscriber)).all()
    all_rows = []
    for r in raw_rows:
        obj = r[0] if not isinstance(r, Subscriber) else r
        if isinstance(obj, Subscriber):
            all_rows.append(obj)

    stats = SubscriberStats(
        total=len(all_rows),
        confirmed=sum(1 for s in all_rows if s.status == "confirmed"),
        pending=sum(1 for s in all_rows if s.status == "pending"),
        unsubscribed=sum(1 for s in all_rows if s.status == "unsubscribed"),
    )

    rows = [s for s in all_rows if not status or s.status == status]
    rows.sort(key=lambda s: s.created_at, reverse=True)

    return {
        "stats": stats.model_dump(),
        "items": [SubscriberRead.model_validate(s) for s in rows],
        "mail_configured": mailer.mail_configured(),
    }


@admin_router.delete("/{subscriber_id}")
def delete_subscriber(
    subscriber_id: int,
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    sub = db.get(Subscriber, subscriber_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="订阅者不存在")
    email = sub.email
    db.delete(sub)
    db.commit()
    logger.info("[订阅] 管理员删除订阅者 %s", email)
    return {"message": "已删除"}


@admin_router.post("/{subscriber_id}/resend")
async def resend_confirm(
    subscriber_id: int,
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """重发确认信（用户反馈没收到时用）"""
    sub = db.get(Subscriber, subscriber_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="订阅者不存在")
    if sub.status == "confirmed":
        raise HTTPException(status_code=400, detail="该邮箱已确认，无需重发")

    ok, err = await _send_confirm_email(db, sub)
    if not ok:
        raise HTTPException(status_code=502, detail=f"发送失败：{err}")
    return {"message": "已重发"}
