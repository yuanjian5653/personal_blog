"""
依赖注入模块
FastAPI 的 Depends 机制允许我们把"获取当前登录管理员"这件事抽成一个可复用的函数。
任何需要登录才能访问的接口，只需声明 current_admin: Admin = Depends(get_current_admin)
"""

#Cookie(default=None, alias="session_token") 中 alias 要和实际 Cookie 名一致。
# 过期 Session 顺手删除，避免表里堆积垃圾数据。
# 时区处理是 Python + MySQL 常见坑：MySQL 的 DATETIME 不存时区，取出来是 naive，必须补 tzinfo。
from collections.abc import Iterator
from datetime import datetime, timezone

from fastapi import Cookie, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_session
from app.models import Admin, AdminSession
from app.models.admin import ROLE_ADMIN, STATUS_ACTIVE


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

    # ---- 5. 账号必须是 active ----
    # 被停用（disabled）或待审核（pending）的账号，即使手里有有效 session 也不能用。
    # 这样管理员一禁用某个成员，对方下一次请求就立刻失效；
    # 另外改角色/禁用时会主动删掉该账号所有 session（见 routers/members.py），
    # 这里是第二道保险。
    if getattr(admin, "status", STATUS_ACTIVE) != STATUS_ACTIVE:
        # 顺手清掉这条 session，避免每次请求都白查一遍
        db.delete(db_session)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被停用或尚未通过审核",
        )

    return admin


def get_current_admin_optional(
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_session),
) -> Admin | None:
    """
    和 get_current_admin 一样校验 Session，但**未登录不报错**，只返回 None。

    用途：既要对公众开放、又要对管理员多返回一些字段的接口。
    例如 GET /api/site-config —— 普通访客拿主题色、站点名等公开配置，
    管理员额外能看到密钥类配置（网易云 MUSIC_U）。

    实现上直接复用 get_current_admin 再吞掉 401，
    这样 Cookie 解析、过期清理、错误文案都只有一份，不会出现两套判定逻辑。
    """
    try:
        return get_current_admin(session_token=session_token, db=db)
    except HTTPException:
        return None


# ============================================================
# 角色与权限
# ============================================================

def get_current_staff(
    admin: Admin = Depends(get_current_admin),
) -> Admin:
    """当前登录的**后台账号**（管理员或成员都算）。

    语义上等同于 get_current_admin，单独起个名字是为了在
    "成员也能用"的接口上读起来更清楚：
        current = Depends(get_current_staff)
    与之对应的 get_current_admin 现在也表示"任何后台账号"，
    真正需要管理员权限的地方请用 require_admin_role。
    """
    return admin


def require_admin_role(
    admin: Admin = Depends(get_current_admin),
) -> Admin:
    """必须是管理员（role=admin）。成员访问会得到 403。

    用在所有"站点级"的接口上：站点配置、音乐、工具、项目、
    成员管理、内容审核、订阅管理、通知队列、操作日志。
    """
    if getattr(admin, "role", ROLE_ADMIN) != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return admin


def is_admin_role(admin: Admin) -> bool:
    """是不是管理员（不抛异常，给路由内部做分支判断用）。"""
    return getattr(admin, "role", ROLE_ADMIN) == ROLE_ADMIN


def can_edit_content(admin: Admin, author_id: int | None) -> bool:
    """这个账号能不能编辑/删除某条内容。

    规则：
      · 管理员       → 任何内容
      · 成员         → 只能动自己发的
      · author_id 为空（迁移前的历史数据）→ 只有管理员能动
        （历史数据都属于站长，成员不该碰）
    """
    if is_admin_role(admin):
        return True
    if author_id is None:
        return False
    return author_id == admin.id


def require_content_owner(admin: Admin, author_id: int | None) -> None:
    """不是自己的内容就抛 403。"""
    if not can_edit_content(admin, author_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能修改自己发布的内容",
        )


def use_my_music_u(
    admin: Admin | None = Depends(get_current_admin_optional),
) -> Iterator[None]:
    """让本次请求的网易云调用用**当前账号自己**的 MUSIC_U。

    挂在网易云路由上即可；没登录或没填过就自动回落到站点配置。
    """
    from app.services.netease import reset_current_music_u, set_current_music_u

    set_current_music_u(getattr(admin, "netease_cookie", None) if admin else None)
    try:
        yield
    finally:
        reset_current_music_u()
