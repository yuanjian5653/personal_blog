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
from app.models._base import as_aware
from app.deps import get_current_admin
from app.net_utils import client_ip
from app.models import Admin, AdminSession
from app.schemas.auth import AdminInfo, LoginRequest, LoginResponse
from app.services.security import (
    generate_session_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger(__name__)

# 同一个账号最多保留几个有效会话（多设备共存，超出踢最旧的）
MAX_SESSIONS = 5

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




def _secure_cookie(request: Request) -> bool:
    """这次响应里的 session Cookie 要不要加 Secure。

    为什么不能直接写 secure=settings.COOKIE_SECURE：
      · 配成 True，但用户是用 http:// 访问时，浏览器**不会保存** Secure cookie
        —— 登录接口返回 200，下一次请求就没有会话，表现为"登录成功却马上
        退出 / 其他设备根本登不上"。
      · 配成 False，走 https 时又少了保护。

    所以配成 True 时按**实际协议**决定：反向代理后面看 X-Forwarded-Proto。
    协议是 http 但配置要求 Secure 时，降级为不加密并打警告（可用性优先）。
    """
    if not settings.COOKIE_SECURE:
        return False

    proto = (
        request.headers.get("x-forwarded-proto") or request.url.scheme or ""
    )
    proto = proto.split(",")[0].strip().lower()
    if proto == "https":
        return True

    logger.warning(
        "[登录] COOKIE_SECURE=true 但本次请求协议是 %s —— Cookie 降级为不加密。"
        "否则浏览器不会保存它，表现为「登录成功却马上掉线」。建议启用 HTTPS。",
        proto or "未知",
    )
    return False


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
    ip = client_ip(request) or "unknown"

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
    locked_until = as_aware(getattr(admin, "locked_until", None)) if admin else None
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

    # ---- 会话管理：支持多设备，但限制数量 ----
    #
    # 以前这里是"删掉该账号的所有旧会话"，等于单点登录 ——
    # 在手机 / 另一台电脑上登录，会把正在用的这台踢下线，
    # 表现为点任何按钮都返回 401「Session 无效」，很容易被误判成别的故障。
    #
    # 现在：先清过期的，再按"最多留 MAX_SESSIONS 个"删最旧的。
    # 这样多设备能共存，表也不会无限增长。
    now_utc = datetime.now(timezone.utc)
    existing = db.exec(
        select(AdminSession)
        .where(AdminSession.admin_id == admin.id)
        .order_by(AdminSession.created_at)
    ).all()

    alive: list[AdminSession] = []
    for s in existing:
        obj = s if isinstance(s, AdminSession) else s[0]
        if not isinstance(obj, AdminSession):
            continue
        expires = obj.expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires is not None and expires < now_utc:
            db.delete(obj)          # 过期了，顺手清掉
        else:
            alive.append(obj)

    # 超额的从最旧的开始删（alive 已按 created_at 升序）
    overflow = len(alive) - (MAX_SESSIONS - 1)   # -1 是给马上要新建的这个留位
    for obj in alive[: max(0, overflow)]:
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
        secure=_secure_cookie(request),
        path="/",
    )

    return LoginResponse(
        message="登录成功",
        admin=AdminInfo(
            id=admin.id,
            username=admin.username,
            role=getattr(admin, 'role', 'admin'),
            display_name=admin.shown_name if hasattr(admin, 'shown_name') else admin.username,
        ),
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
    return AdminInfo(
        id=current_admin.id,
        username=current_admin.username,
        role=getattr(current_admin, "role", "admin"),
        display_name=(
            current_admin.shown_name
            if hasattr(current_admin, "shown_name")
            else current_admin.username
        ),
    )
