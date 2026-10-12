"""
依赖注入模块
FastAPI 的 Depends 机制允许我们把"获取当前登录管理员"这件事抽成一个可复用的函数。
任何需要登录才能访问的接口，只需声明 current_admin: Admin = Depends(get_current_admin)
"""

#Cookie(default=None, alias="session_token") 中 alias 要和实际 Cookie 名一致。
# 过期 Session 顺手删除，避免表里堆积垃圾数据。
# 时区处理是 Python + MySQL 常见坑：MySQL 的 DATETIME 不存时区，取出来是 naive，必须补 tzinfo。
from datetime import datetime, timezone

from fastapi import Cookie, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_session
from app.models import Admin, AdminSession


def get_current_admin(
    # Cookie(...) 表示从请求的 Cookie 中读取名为 "session_token" 的值
    # 如果前端没带这个 Cookie，FastAPI 会自动返回 422，但我们可以手动控制
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_session),
) -> Admin:
    """
    从 Cookie 中解析 Session，返回当前登录的管理员。

    执行流程：
    1. 没带 Cookie → 401
    2. Cookie 里的 token 在数据库找不到 → 401（伪造或已删除）
    3. Session 已过期 → 401
    4. 全部通过 → 返回对应的 Admin 对象

    作为依赖使用时，如果抛出 HTTPException，FastAPI 会直接中断请求并返回错误，
    不会进入真正的接口函数。所以受保护接口里不用再写鉴权代码。
    """
    # ---- 1. 检查 Cookie 是否存在 ----
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录",
        )

    # ---- 2. 根据 token 查 Session 记录 ----
    # select(AdminSession) 生成查询语句，.where() 加过滤条件
    stmt = select(AdminSession).where(AdminSession.session_token == session_token)
    # db.exec(stmt).first() 执行查询并取第一条结果（没有则返回 None）
    db_session = db.exec(stmt).first()

    if db_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session 无效",
        )

    # ---- 3. 检查是否过期 ----
    # 数据库里存的是带时区的 UTC 时间，取出来可能是 naive datetime
    # 为了安全比较，统一转成带时区的
    now = datetime.now(timezone.utc)
    expires_at = db_session.expires_at
    # 如果从 MySQL 取出来的是 naive datetime（没有 tzinfo），补上 UTC
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < now:
        # 过期就顺手删掉这条记录，保持数据库干净
        db.delete(db_session)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session 已过期，请重新登录",
        )

    # ---- 4. 查出管理员对象 ----
    admin = db.get(Admin, db_session.admin_id)
    if admin is None:
        # 理论上不会发生（外键约束），但防御性处理
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员不存在",
        )

    return admin