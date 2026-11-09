"""
认证路由：登录 / 登出 / 当前管理员。

---- 安全设计（这一版重点加固过）----

1. **Cookie 标志从配置读，不再写死 secure=False**
   之前 secure 被硬编码成 False，注释写着"生产环境要改 True"但没人改 ——
   意味着管理员会话 Cookie 在 HTTPS 站点上也会被浏览器允许走明文 HTTP 发送，
   任何一次 http:// 请求（或中间人强制降级）都会让 session token 裸奔。
   现在读 settings.COOKIE_SECURE / COOKIE_SAMESITE（生产必须 secure=true）。

2. **连续失败锁定（账号级）**
   连续 5 次密码错误 → 锁定 15 分钟，期间一律 429。
   bcrypt 只是让每次尝试变慢，挡不住长期低速爆破，必须有计数。

3. **IP 滑动窗口（进程级，兜底）**
   同一 IP 10 分钟内失败超过 20 次 → 429。
   账号锁定挡"猜某个账号"，这一层挡"换着账号名猜"。

4. **用户名不存在时也跑一次 bcrypt**
   否则"用户不存在"会明显快于"密码错误"，能被计时侧信道区分出来。
   这里用一个固定的假哈希做等时校验。

5. **登录成功时清掉该账号的旧会话**
   避免历史 token（可能已经泄漏）继续有效。

6. **错误信息不区分"用户不存在"和"密码错误"**
"""
import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, AdminSession
from app.schemas.auth import AdminInfo, LoginRequest, LoginResponse
from app.services.security import (
    generate_session_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["认证"])

COOKIE_NAME = "session_token"

# ---- 账号锁定策略 ----
MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 15

# ---- IP 滑动窗口策略 ----
IP_WINDOW_SECONDS = 600
IP_MAX_FAILURES = 20

# 用户名不存在时拿来做等时校验的假哈希。
# 内容无所谓，只要是个合法 bcrypt 串；进程启动时算一次即可。
_DUMMY_HASH = hash_password("timing-equalizer-not-a-real-password")

# IP → 失败时间戳列表（进程内，重启即清空；够用且不增加数据库负担）
_ip_failures: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    """取真实客户端 IP。

    与 subscribe.py 的处理一致：优先 X-Forwarded-For 第一段（nginx 反代时写入），
    取不到再退回直连地址。
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _ip_blocked(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _ip_failures.get(ip, []) if now - t < IP_WINDOW_SECONDS]
    _ip_failures[ip] = hits
    return len(hits) >= IP_MAX_FAILURES


def _record_ip_failure(ip: str) -> None:
    now = time.time()
    hits = [t for t in _ip_failures.get(ip, []) if now - t < IP_WINDOW_SECONDS]
    hits.append(now)
    _ip_failures[ip] = hits
    # 防止字典无限增长：条目太多时清掉过期的
    if len(_ip_failures) > 5000:
        for key in list(_ip_failures.keys()):
            if not _ip_failures[key]:
                _ip_failures.pop(key, None)


def _as_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


@router.post("/login", response_model=LoginResponse)
def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_session),
):
    """管理员登录。

    流程：IP 限速 → 账号锁定检查 → 校验密码 → 失败计数 → 成功则轮换会话。
    """
    ip = _client_ip(request)

    # ---- 0. IP 层限速 ----
    if _ip_blocked(ip):
        logger.warning("[登录] IP %s 失败次数过多，已临时拒绝", ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="尝试次数过多，请稍后再试",
        )

    # ---- 1. 查用户 ----
    stmt = select(Admin).where(Admin.username == data.username)
    row = db.exec(stmt).first()
    admin = row if isinstance(row, Admin) else (row[0] if row else None)

    # ---- 2. 账号锁定检查（放在密码校验之前，避免锁定期还能靠耗时探信息）----
    locked_until = _as_aware(getattr(admin, "locked_until", None)) if admin else None
    now = datetime.now(timezone.utc)
    if admin is not None and locked_until is not None and locked_until > now:
        remain = int((locked_until - now).total_seconds() // 60) + 1
        logger.warning("[登录] 账号 %s 处于锁定状态", admin.username)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"账号已被临时锁定，请 {remain} 分钟后再试",
        )

    # ---- 3. 校验密码 ----
    # 用户不存在时也跑一次 bcrypt，抹平耗时差异
    if admin is None:
        verify_password(data.password, _DUMMY_HASH)
        _record_ip_failure(ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    if not verify_password(data.password, admin.password_hash):
        _record_ip_failure(ip)
        admin.failed_attempts = (admin.failed_attempts or 0) + 1
        if admin.failed_attempts >= MAX_FAILED_ATTEMPTS:
            admin.locked_until = now + timedelta(minutes=LOCK_MINUTES)
            admin.failed_attempts = 0  # 锁定后清零，解锁即重新计数
            logger.warning(
                "[登录] 账号 %s 连续失败 %d 次，锁定 %d 分钟",
                admin.username,
                MAX_FAILED_ATTEMPTS,
                LOCK_MINUTES,
            )
        db.add(admin)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    # ---- 4. 登录成功：清计数、解锁、清旧会话 ----
    admin.failed_attempts = 0
    admin.locked_until = None
    db.add(admin)

    old_sessions = db.exec(
        select(AdminSession).where(AdminSession.admin_id == admin.id)
    ).all()
    for s in old_sessions:
        obj = s if isinstance(s, AdminSession) else s[0]
        if isinstance(obj, AdminSession):
            db.delete(obj)

    token = generate_session_token()
    expires_at = now + timedelta(days=settings.SESSION_EXPIRE_DAYS)
    db.add(
        AdminSession(
            admin_id=admin.id,
            session_token=token,
            expires_at=expires_at,
        )
    )
    db.commit()

    logger.info("[登录] %s 登录成功（IP %s）", admin.username, ip)

    # ---- 5. Cookie：从配置读安全标志 ----
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.SESSION_EXPIRE_DAYS * 24 * 3600,
        httponly=True,                       # 禁止 JS 读取，防 XSS 窃取
        samesite=settings.COOKIE_SAMESITE,   # 防 CSRF
        # 生产必须 true：否则浏览器允许这个 Cookie 随明文 HTTP 请求一起发出，
        # 一次 http:// 访问就能让会话 token 被中间人拿到。
        secure=settings.COOKIE_SECURE,
        path="/",
    )

    return LoginResponse(
        message="登录成功",
        admin=AdminInfo(id=admin.id, username=admin.username),
    )


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
):
    """登出：删掉这条会话并按同样的标志清 Cookie。"""
    if session_token:
        stmt = select(AdminSession).where(AdminSession.session_token == session_token)
        row = db.exec(stmt).first()
        db_session = row if isinstance(row, AdminSession) else (row[0] if row else None)
        if db_session is not None:
            db.delete(db_session)
            db.commit()

    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
    )
    return {"message": "已登出"}


@router.get("/me", response_model=AdminInfo)
def get_me(current_admin: Admin = Depends(get_current_admin)):
    """当前登录的管理员信息；未登录返回 401。"""
    return AdminInfo(id=current_admin.id, username=current_admin.username)
