"""
认证路由
提供登录、登出、获取当前管理员信息三个接口
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, AdminSession
from app.schemas.auth import AdminInfo, LoginRequest, LoginResponse
from app.services.security import generate_session_token, verify_password

# APIRouter 相当于一个"子应用"，把同一模块的接口聚合在一起
# prefix 统一加前缀，tags 用于 Swagger 文档分组
router = APIRouter(prefix="/api/auth", tags=["认证"])

# Cookie 名称常量，前后端约定好
COOKIE_NAME = "session_token"


@router.post("/login", response_model=LoginResponse)
def login(
    data: LoginRequest,
    response: Response,                       # 用来设置 Cookie
    db: Session = Depends(get_session),
):
    """
    管理员登录。

    流程:
    1. 根据用户名查管理员
    2. 校验密码
    3. 生成 Session Token，写入数据库
    4. 把 Token 写进 HttpOnly Cookie 返回
    """
    # ---- 1. 查用户 ----
    stmt = select(Admin).where(Admin.username == data.username)
    admin = db.exec(stmt).first()

    # ---- 2. 校验用户名和密码 ----
    # 注意：用户名不存在和密码错误返回同样的提示，
    # 避免攻击者通过错误信息推测哪些用户名存在
    if admin is None or not verify_password(data.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    # ---- 3. 生成 Session ----
    token = generate_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.SESSION_EXPIRE_DAYS)

    db_session = AdminSession(
        admin_id=admin.id,
        session_token=token,
        expires_at=expires_at,
    )
    db.add(db_session)
    db.commit()

    # ---- 4. 写入 Cookie ----
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.SESSION_EXPIRE_DAYS * 24 * 3600,  # 秒
        httponly=True,        # 禁止 JS 读取，防 XSS 窃取
        samesite="lax",       # 防 CSRF，同时允许同站跳转携带
        secure=False,         # 本地开发用 HTTP，生产环境要改 True（HTTPS）
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
    """
    登出。

    流程:
    1. 删除数据库里的 Session 记录
    2. 清除浏览器 Cookie
    """
    if session_token:
        stmt = select(AdminSession).where(AdminSession.session_token == session_token)
        db_session = db.exec(stmt).first()
        if db_session:
            db.delete(db_session)
            db.commit()

    response.delete_cookie(COOKIE_NAME, path="/")
    return {"message": "已登出"}


@router.get("/me", response_model=AdminInfo)
def get_me(current_admin: Admin = Depends(get_current_admin)):
    """
    获取当前登录管理员信息。
    前端可以用这个接口判断"是否已登录"：
    - 返回 200 和用户信息 → 已登录
    - 返回 401 → 未登录
    """
    return AdminInfo(id=current_admin.id, username=current_admin.username)