"""
内容更新通知（outbox + 后台 worker）

流程：
    发布文章/随笔/生活动态
        └─▶ enqueue_*()  写一条 outbox 记录（毫秒级，不影响发布请求）
              └─▶ worker 每 N 秒扫一次到期的记录
                    ├─ 取该批所有到期记录，**合并成一封邮件**
                    ├─ 给每个已确认订阅者发一封（各带自己的退订链接）
                    └─ 标记 sent / 失败则重试，3 次后 failed

为什么不用 Celery / Redis：
    这台服务器只有 1.6G 内存，Celery + Redis 起步就要 200MB 加上一堆运维成本。
    一个 asyncio 任务 + 一张表足够撑住"几十个订阅者、一天几封"的量。

冷却合并（避免一天发好几封）：
    入队时算 scheduled_at = max(now, 上次发送时间 + 冷却期)，
    于是冷却期内的多条内容会一起到期，worker 合并成一封。
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlmodel import Session

from app.config import settings
from app.database import engine
from app.models import NotificationOutbox, Subscriber
from app.services import mailer

logger = logging.getLogger(__name__)

# 单批最多处理多少条通知（合并进同一封邮件）
MAX_ITEMS_PER_MAIL = 10
# 每批最多发给多少个订阅者（防止一次跑太久占着 worker）
MAX_RECIPIENTS_PER_RUN = 200
# 发送间隔（秒）—— 阿里云 SMTP 有频率限制，太快会被限流
SEND_INTERVAL = 0.5
# 卡在 sending 超过这个时间视为进程崩溃遗留，重置回 pending
STALE_SENDING_MINUTES = 10
# 失败重试间隔与上限
RETRY_DELAY_MINUTES = 10
MAX_ATTEMPTS = 3


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _model(row):
    """把 exec() 的返回解包成模型实例。

    本项目这个版本的 SQLModel，`db.exec(select(Model)).all()` 返回的**不是**
    模型实例而是 `Row`（`row[0]` 才是模型）。之前用 `isinstance` 判断，
    结果这些行全被跳过了 —— worker 一条都处理不到。
    所以统一走这个 helper，兼容两种形态。
    """
    if row is None:
        return None
    try:
        first = row[0]
    except (TypeError, IndexError, KeyError):
        return row
    return first if first is not None else row


def _models(rows):
    out = []
    for r in rows:
        m = _model(r)
        if m is not None:
            out.append(m)
    return out


# ============================================================
# 入队（供各 router 调用）
# ============================================================

def _enqueue(
    event_type: str,
    target_type: str,
    target_id: int,
    title: str,
    summary: str | None,
    path: str,
) -> bool:
    """写一条待发记录。返回是否新插入（重复内容返回 False）。

    刻意用独立 Session：调用方（发布接口）已经 commit 过了，
    这里即使失败也不能影响内容本身，所以整体 try/except 兜住。
    """
    try:
        with Session(engine) as db:
            exists = db.exec(
                select(NotificationOutbox.id).where(
                    NotificationOutbox.event_type == event_type,
                    NotificationOutbox.target_type == target_type,
                    NotificationOutbox.target_id == target_id,
                )
            ).first()
            if exists is not None:
                logger.info("[通知] %s#%s 已入队过，跳过", target_type, target_id)
                return False

            now = _utcnow()
            scheduled = now

            # 冷却合并：距上次发送不足冷却期就顺延
            cooldown_min = max(0, settings.NOTIFY_COOLDOWN_MINUTES)
            if cooldown_min > 0:
                # 取"最近一次成功发送的时间"。
                # 特意不用 func.max()：这个版本 exec 会把它包成 Row，
                # `.one_or_none()` 拿到的是 (None,) 而不是 None，判断很容易写错。
                last_row = db.exec(
                    select(NotificationOutbox.sent_at)
                    .where(
                        NotificationOutbox.status == "sent",
                        NotificationOutbox.sent_at.is_not(None),
                    )
                    .order_by(NotificationOutbox.sent_at.desc())
                    .limit(1)
                ).first()
                last_sent = None
                if last_row is not None:
                    last_sent = last_row[0] if not isinstance(last_row, datetime) else last_row
                if last_sent is not None:
                    earliest = last_sent + timedelta(minutes=cooldown_min)
                    if earliest > now:
                        scheduled = earliest

            row = NotificationOutbox(
                event_type=event_type,
                target_type=target_type,
                target_id=target_id,
                title=(title or "").strip()[:300] or "(无标题)",
                summary=(summary or "").strip()[:500] or None,
                url=path,
                status="pending",
                scheduled_at=scheduled,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            db.commit()
            logger.info(
                "[通知] 已入队 %s#%s，计划发送 %s", target_type, target_id, scheduled
            )
            return True
    except Exception:
        # 通知失败绝不能影响发布
        logger.exception("[通知] 入队失败（已忽略，不影响内容发布）")
        return False


def _plain(text: str, limit: int = 120) -> str:
    """把 Markdown 正文压成一行摘要。"""
    import re

    t = re.sub(r"```.*?```", " ", text or "", flags=re.S)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"[#>*_`~\-]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit]


def enqueue_article_published(article) -> bool:
    """文章发布时通知"""
    slug = getattr(article, "slug", None)
    if not slug:
        return False
    summary = getattr(article, "excerpt", None) or _plain(
        getattr(article, "content", "") or ""
    )
    return _enqueue(
        "article.new",
        "article",
        int(article.id),
        getattr(article, "title", "") or "",
        summary,
        f"/articles/{slug}",
    )


def enqueue_essay_created(essay) -> bool:
    """随笔：没有详情页，统一跳到 /essays"""
    title = (getattr(essay, "title", "") or "").strip()
    summary = getattr(essay, "excerpt", None) or _plain(
        getattr(essay, "content", "") or ""
    )
    # 随笔常常只有正文没有标题，那就拿正文本体当标题
    display_title = title or _plain(getattr(essay, "content", "") or "", 40) or "新的随笔"
    return _enqueue(
        "essay.new", "essay", int(essay.id), display_title, summary, "/essays"
    )


def enqueue_life_created(post) -> bool:
    """生活动态：跳到 /life"""
    body = _plain(getattr(post, "content", "") or "")
    location = (getattr(post, "location", "") or "").strip()
    display_title = body[:40] or "新的动态"
    summary = body if len(body) > 40 else None
    if location:
        display_title = f"{display_title}（{location}）"
    return _enqueue("life.new", "life", int(post.id), display_title, summary, "/life")


# ============================================================
# 邮件渲染
# ============================================================

_EVENT_LABEL = {
    "article.new": "新文章",
    "essay.new": "新随笔",
    "life.new": "新动态",
}


def render_digest(
    items: list[NotificationOutbox], unsubscribe_url: str
) -> tuple[str, str, str]:
    """渲染一封"内容更新"邮件，返回 (主题, 纯文本, HTML)。"""
    count = len(items)
    subject = (
        f"{_EVENT_LABEL.get(items[0].event_type, '更新')}：{items[0].title}"
        if count == 1
        else f"{settings.MAIL_FROM_NAME} 更新了 {count} 条内容"
    )

    base = settings.SITE_URL.rstrip("/")

    text_lines = [f"{settings.MAIL_FROM_NAME} 有新内容：", ""]
    for it in items:
        label = _EVENT_LABEL.get(it.event_type, "更新")
        text_lines.append(f"[{label}] {it.title}")
        if it.summary:
            text_lines.append(f"    {it.summary}")
        text_lines.append(f"    {base}{it.url}")
        text_lines.append("")
    text_lines.append("——")
    text_lines.append(f"不想再收到通知？点这里退订：{unsubscribe_url}")
    text = "\n".join(text_lines)

    cards = []
    for it in items:
        label = _EVENT_LABEL.get(it.event_type, "更新")
        summary_html = (
            f'<p style="margin:6px 0 0;font-size:13px;line-height:1.7;color:#6b7280;">'
            f"{it.summary}</p>"
            if it.summary
            else ""
        )
        cards.append(
            f"""<div style="padding:16px 0;border-top:1px solid #eef0f2;">
  <div style="font-size:11px;letter-spacing:.08em;color:#9ca3af;text-transform:uppercase;">{label}</div>
  <a href="{base}{it.url}" style="display:block;margin-top:6px;font-size:15px;
     font-weight:600;color:#111827;text-decoration:none;">{it.title}</a>
  {summary_html}
  <a href="{base}{it.url}" style="display:inline-block;margin-top:10px;font-size:12px;
     color:#2563eb;text-decoration:none;">阅读 →</a>
</div>"""
        )

    html = f"""\
<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f4;
  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
  color:#1f2937;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;
    padding:26px 24px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 4px;font-size:17px;">{settings.MAIL_FROM_NAME} · 内容更新</h1>
    <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
      共 {count} 条新内容
    </p>
    {"".join(cards)}
    <hr style="border:none;border-top:1px solid #eef0f2;margin:16px 0;" />
    <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.8;">
      你收到这封邮件是因为在本站订阅了更新。<br />
      <a href="{unsubscribe_url}" style="color:#9ca3af;">点此退订</a>
    </p>
  </div>
</body></html>"""

    return subject, text, html


# ============================================================
# worker
# ============================================================

async def _send_batch() -> None:
    """处理一批到期的通知。没有到期项时立即返回。"""
    now = _utcnow()

    with Session(engine) as db:
        # 崩溃遗留的 sending 记录：超过 10 分钟就放回 pending
        stale_before = now - timedelta(minutes=STALE_SENDING_MINUTES)
        stale = _models(
            db.exec(
                select(NotificationOutbox).where(
                    NotificationOutbox.status == "sending",
                    NotificationOutbox.updated_at < stale_before,
                )
            ).all()
        )
        for obj in stale:
            obj.status = "pending"
            obj.updated_at = now
            db.add(obj)
        if stale:
            db.commit()
            logger.warning("[通知] 重置了 %d 条卡在 sending 的记录", len(stale))

        # 宽限 1 秒：MySQL 的 DATETIME 没有小数秒，插入时毫秒会**四舍五入**，
        # 刚写入的行读数可能"比 now 还晚"零点几秒，严格用 `<= now` 会漏掉它。
        cutoff = now + timedelta(seconds=1)
        due_rows = db.exec(
            select(NotificationOutbox)
            .where(
                NotificationOutbox.status == "pending",
                NotificationOutbox.scheduled_at <= cutoff,
            )
            .order_by(NotificationOutbox.id)
            .limit(MAX_ITEMS_PER_MAIL)
        ).all()
        items = _models(due_rows)
        if not items:
            return

        # 先"认领"，避免多个 worker/重入时重复发
        for it in items:
            it.status = "sending"
            it.updated_at = now
            db.add(it)
        db.commit()

        recipients = _models(
            db.exec(
                select(Subscriber)
                .where(Subscriber.status == "confirmed")
                .order_by(Subscriber.id)
                .limit(MAX_RECIPIENTS_PER_RUN)
            ).all()
        )

        if not recipients:
            # 没有订阅者也要把记录标记掉，否则会一直堆着
            for it in items:
                it.status = "sent"
                it.sent_at = now
                it.sent_count = 0
                it.updated_at = now
                db.add(it)
            db.commit()
            logger.info("[通知] %d 条通知到期，但当前没有已确认订阅者", len(items))
            return

        # 每个订阅者的退订链接不同，所以邮件要逐封渲染（下面循环内调用）
        sent = 0
        last_error: str | None = None

        for sub in recipients:
            unsub = f"{settings.SITE_URL}/api/subscribe/unsubscribe?token={sub.unsubscribe_token}"
            s, t, h = render_digest(items, unsub)
            ok, err = await mailer.try_send_mail(sub.email, s, t, h, unsub)
            if ok:
                sent += 1
            else:
                last_error = err
            await asyncio.sleep(SEND_INTERVAL)

        ids = [it.id for it in items]
        if sent > 0:
            for it in items:
                it.status = "sent"
                it.sent_at = now
                it.sent_count = sent
                it.updated_at = now
                db.add(it)
            db.commit()
            logger.info("[通知] 已发送 %d 条内容给 %d 位订阅者", len(items), sent)
        else:
            # 全军覆没：重试有限次数，避免永久卡住
            delay = timedelta(minutes=RETRY_DELAY_MINUTES)
            for it in items:
                it.attempts = (it.attempts or 0) + 1
                it.last_error = (last_error or "发送失败")[:500]
                it.updated_at = now
                if it.attempts >= MAX_ATTEMPTS:
                    it.status = "failed"
                else:
                    it.status = "pending"
                    it.scheduled_at = now + delay
                db.add(it)
            db.commit()
            logger.warning(
                "[通知] 全部发送失败（%d 条），已安排重试：%s", len(items), last_error
            )


async def worker_loop() -> None:
    """常驻任务：由 main.py 的 lifespan 启动与取消"""
    if not settings.NOTIFY_ENABLED:
        logger.info("[通知] 自动推送未启用（NOTIFY_ENABLED=false），worker 不启动")
        return
    if not settings.mail_enabled:
        logger.info("[通知] 邮件未配置，worker 不启动（配好后重启后端即可）")
        return

    logger.info(
        "[通知] worker 已启动：轮询 %ss，冷却 %s 分钟",
        settings.NOTIFY_POLL_SECONDS,
        settings.NOTIFY_COOLDOWN_MINUTES,
    )
    while True:
        try:
            await _send_batch()
        except asyncio.CancelledError:
            logger.info("[通知] worker 收到取消信号，退出")
            raise
        except Exception:
            logger.exception("[通知] worker 本轮出错（已忽略，继续下一轮）")
        await asyncio.sleep(max(5, settings.NOTIFY_POLL_SECONDS))
