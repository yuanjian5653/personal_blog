"""
上传配额：每月每账号最多传多少张。

管理员不受限（quota=0 也表示不限）。
成员默认 DEFAULT_MEMBER_UPLOAD_QUOTA 张/月，可在成员管理里单独调整。

统计口径用 upload_logs（每次成功上传记一行），
而不是数 photos 表 —— 后者漏掉文章配图、说说配图、封面等入口。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlmodel import Session, func, select

from app.models import Admin, UploadLog
from app.models.admin import DEFAULT_MEMBER_UPLOAD_QUOTA
from app.db_utils import count as db_count

logger = logging.getLogger(__name__)


def _month_start_expr():
    """本月 1 号 —— 交给 MySQL 算，避免 Python 时区 datetime 绑定的坑。

    SQLModel 对 timezone-aware datetime 的绑定有额外限制，
    直接把"月初"写成 SQL 表达式（DATE_FORMAT(NOW(), '%Y-%m-01')）最省事，
    也不受应用与数据库时区差异影响。
    """
    return func.date_format(func.now(), "%Y-%m-01")


def monthly_usage(db: Session, admin_id: int) -> int:
    """本自然月已上传张数。"""
    n = db.exec(
        select(func.count())
        .select_from(UploadLog)
        .where(UploadLog.admin_id == admin_id)
        .where(UploadLog.created_at >= _month_start_expr())
    ).one()
    return db_count(n)


def effective_quota(admin: Admin) -> int:
    """这个账号的配额。0 = 不限。"""
    if getattr(admin, "role", "admin") == "admin":
        return 0
    q = getattr(admin, "upload_quota", None)
    if q is None:
        return DEFAULT_MEMBER_UPLOAD_QUOTA
    return int(q)


def ensure_upload_quota(db: Session, admin: Admin) -> None:
    """超出配额就抛 429。

    注意用 429（Too Many Requests）而不是 403：
    这是"用完了，等下个月"，不是"你没权限"。
    """
    quota = effective_quota(admin)
    if quota <= 0:
        return

    used = monthly_usage(db, int(admin.id or 0))
    if used >= quota:
        logger.warning(
            "[配额] %s 本月已上传 %d 张（上限 %d），拒绝继续上传",
            getattr(admin, "username", "?"),
            used,
            quota,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"本月上传已达上限（{used}/{quota} 张），下个月恢复，"
            f"或联系管理员调整配额",
        )


def record_upload(
    db: Session, admin_id: int, kind: str, filename: str | None, size: int = 0
) -> None:
    """记一次上传。调用方负责 commit（通常跟内容一起提交）。"""
    db.add(
        UploadLog(
            admin_id=admin_id,
            kind=kind,
            filename=filename,
            size=size,
        )
    )
