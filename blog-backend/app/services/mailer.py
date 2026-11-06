"""
发信服务（阿里云邮件推送 · SMTP）

为什么用 SMTP + 标准库，而不是阿里云 API / aiosmtplib：
  · API 要装阿里云 SDK（一堆依赖），而这台服务器只有 1.6G 内存
  · SMTP 走自写 HTML，**不需要提交模板审核**（只有 BatchSendMail 才要）
  · smtplib 是标准库，用 asyncio.to_thread 丢到线程里跑即可，
    不阻塞事件循环，也没有新增依赖

关键约束（都是踩过或容易踩的）：
  · 465 端口是**隐式 SSL**，要用 SMTP_SSL；587 才是 STARTTLS
  · 登录名必须与 From 地址**完全一致**，否则报 553
  · 密码必须是纯 ASCII —— 若误把中文占位符贴进去，
    smtplib 会抛 UnicodeEncodeError（本地就是这样踩到的），这里提前检查
  · 每封都要带 List-Unsubscribe / List-Unsubscribe-Post：
    既是合规要求，也是不进垃圾箱的关键
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from app.config import settings

logger = logging.getLogger(__name__)


class MailError(RuntimeError):
    """发信失败（配置缺失 / 认证失败 / 网络不通）"""


def _build_message(
    to_email: str,
    subject: str,
    text: str,
    html: str,
    unsubscribe_url: str | None = None,
) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((settings.MAIL_FROM_NAME, settings.MAIL_FROM))
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=settings.MAIL_FROM.partition("@")[2] or None)

    if settings.MAIL_REPLY_TO:
        msg["Reply-To"] = settings.MAIL_REPLY_TO

    if unsubscribe_url:
        # 一键退订：RFC 8058。QQ/163/Gmail 都会据此显示"退订"按钮，
        # 有它的邮件被判垃圾的概率明显更低。
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    return msg


def _send_sync(msg: EmailMessage) -> None:
    """同步发信（在线程里执行）"""
    if not settings.mail_enabled:
        raise MailError("邮件功能未配置（MAIL_FROM / MAIL_PASSWORD 为空）")

    password = settings.MAIL_PASSWORD
    if not password.isascii():
        # 本地调试时踩过：把中文说明当密码贴进去，smtplib 会抛
        # UnicodeEncodeError，报错信息完全看不出是密码的问题。
        raise MailError("MAIL_PASSWORD 含非 ASCII 字符，请检查是否填了占位说明文字")

    context = ssl.create_default_context()
    try:
        if settings.MAIL_PORT == 465:
            with smtplib.SMTP_SSL(
                settings.MAIL_HOST, settings.MAIL_PORT, timeout=20, context=context
            ) as smtp:
                smtp.login(settings.MAIL_FROM, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(settings.MAIL_HOST, settings.MAIL_PORT, timeout=20) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.login(settings.MAIL_FROM, password)
                smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        raise MailError(f"SMTP 认证失败：{exc}") from exc
    except (smtplib.SMTPException, OSError) as exc:
        raise MailError(f"SMTP 发送失败：{exc}") from exc


async def send_mail(
    to_email: str,
    subject: str,
    text: str,
    html: str,
    unsubscribe_url: str | None = None,
) -> None:
    """异步发一封信。失败抛 MailError。"""
    msg = _build_message(to_email, subject, text, html, unsubscribe_url)
    # smtplib 是阻塞 IO，丢到线程池，避免卡住事件循环
    # （FastAPI 的其它请求会因此全部变慢，之前用同步 requests 时踩过这个坑）
    await asyncio.to_thread(_send_sync, msg)


async def try_send_mail(
    to_email: str,
    subject: str,
    text: str,
    html: str,
    unsubscribe_url: str | None = None,
) -> tuple[bool, str | None]:
    """发信但不抛异常，返回 (是否成功, 错误信息)。给"不该因发信失败而 500"的场景用。"""
    try:
        await send_mail(to_email, subject, text, html, unsubscribe_url)
        return True, None
    except MailError as exc:
        logger.warning("[邮件] 发送到 %s 失败：%s", to_email, exc)
        return False, str(exc)
    except Exception as exc:  # pragma: no cover - 兜底
        logger.exception("[邮件] 未知错误")
        return False, str(exc)


def mail_configured() -> bool:
    return settings.mail_enabled


# ============================================================
# 订阅确认信
# ============================================================

def render_confirm_email(
    confirm_url: str, unsubscribe_url: str
) -> tuple[str, str, str]:
    """返回 (主题, 纯文本, HTML)。

    邮件客户端不加载外部 CSS，所以全部用内联样式。
    纯文本版本不是可选项：只发 HTML 会显著提高被判垃圾邮件的概率。
    """
    subject = f"确认订阅 · {settings.MAIL_FROM_NAME}"

    text = (
        "你（或有人）用这个邮箱请求订阅本站更新。\n\n"
        f"点下面的链接完成确认：\n{confirm_url}\n\n"
        "确认后，本站发布新内容时会给你发一封通知邮件。\n\n"
        "如果这不是你本人操作的，忽略这封邮件即可，不会订阅成功。\n"
        f"取消订阅：{unsubscribe_url}\n"
    )

    html = f"""\
<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f4;
  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
  color:#1f2937;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;
    padding:28px 26px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 6px;font-size:18px;">确认订阅</h1>
    <p style="margin:0 0 18px;font-size:13px;color:#6b7280;line-height:1.7;">
      你（或有人）用这个邮箱请求订阅本站更新。点下面的按钮完成确认。
    </p>
    <p style="margin:0 0 20px;">
      <a href="{confirm_url}"
         style="display:inline-block;padding:10px 22px;border-radius:999px;
                background:#cac36d;color:#1f2937;text-decoration:none;
                font-size:14px;font-weight:600;">确认订阅</a>
    </p>
    <p style="margin:0 0 6px;font-size:12px;color:#6b7280;line-height:1.8;">
      按钮点不开的话，把下面这个地址复制到浏览器：
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#2563eb;word-break:break-all;
      line-height:1.6;">{confirm_url}</p>
    <hr style="border:none;border-top:1px solid #eef0f2;margin:18px 0;" />
    <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.8;">
      如果这不是你本人操作的，忽略这封邮件即可，不会订阅成功。<br />
      不想再收到通知？<a href="{unsubscribe_url}" style="color:#9ca3af;">点此退订</a>
    </p>
  </div>
</body></html>"""

    return subject, text, html
