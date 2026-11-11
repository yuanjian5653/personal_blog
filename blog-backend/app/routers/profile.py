"""
「我的资料」—— 每个后台账号编辑自己的关于页信息（含昵称）。

  GET /api/admin/profile   读自己的档案（不存在则返回默认值）
  PUT /api/admin/profile   保存

为什么单独一套而不是复用 /admin/profile：
    /admin/profile 编辑的是 site_config 里的**站点级**配置
    （author_name / about_content …），改的是首页那张个人卡片。
    这里编辑的是 author_profiles 里**每个账号自己的一份**，
    互不影响 —— 成员改自己的不会动到站长的。

现阶段只做数据存取：前台还没有 /members 页面消费它（阶段 3 做）。
作者标签用的 nickname 就是这个接口写进去的值。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_admin, get_current_staff
from app.models import Admin, AuthorProfile
from app.models._base import utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/profile", tags=["我的资料"])


class ProfileRead(BaseModel):
    admin_id: int
    username: str
    role: str
    nickname: str | None = None
    avatar_url: str | None = None
    bio: str | None = None
    social_github: str | None = None
    social_email: str | None = None
    social_telegram: str | None = None
    social_discord: str | None = None
    about_banner: str | None = None
    about_subtitle: str | None = None
    about_content: str | None = None
    is_public: bool = False


class ProfileUpdate(BaseModel):
    nickname: str | None = Field(default=None, max_length=60)
    avatar_url: str | None = Field(default=None, max_length=500)
    bio: str | None = Field(default=None, max_length=300)
    social_github: str | None = Field(default=None, max_length=300)
    social_email: str | None = Field(default=None, max_length=200)
    social_telegram: str | None = Field(default=None, max_length=200)
    social_discord: str | None = Field(default=None, max_length=200)
    about_banner: str | None = Field(default=None, max_length=500)
    about_subtitle: str | None = Field(default=None, max_length=200)
    about_content: str | None = None
    is_public: bool | None = None


def _get_or_create(db: Session, admin_id: int) -> AuthorProfile:
    row = db.exec(
        select(AuthorProfile).where(AuthorProfile.admin_id == admin_id)
    ).first()
    prof = row if isinstance(row, AuthorProfile) else (row[0] if row else None)
    if prof is None:
        prof = AuthorProfile(admin_id=admin_id)
        db.add(prof)
        db.commit()
        db.refresh(prof)
    return prof


def _to_read(prof: AuthorProfile, admin: Admin) -> ProfileRead:
    return ProfileRead(
        admin_id=int(prof.admin_id),
        username=admin.username,
        role=getattr(admin, "role", "admin"),
        nickname=prof.nickname,
        avatar_url=prof.avatar_url,
        bio=prof.bio,
        social_github=prof.social_github,
        social_email=prof.social_email,
        social_telegram=prof.social_telegram,
        social_discord=prof.social_discord,
        about_banner=prof.about_banner,
        about_subtitle=prof.about_subtitle,
        about_content=prof.about_content,
        is_public=bool(prof.is_public),
    )


@router.get("", response_model=ProfileRead)
def get_my_profile(
    db: Session = Depends(get_session),
    me: Admin = Depends(get_current_staff),
):
    """读自己的档案。第一次访问会自动创建一条空档案。"""
    prof = _get_or_create(db, int(me.id or 0))
    return _to_read(prof, me)


@router.put("", response_model=ProfileRead)
def update_my_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_session),
    me: Admin = Depends(get_current_staff),
):
    """保存自己的档案。只能改自己的 —— admin_id 来自登录态，不接受传参。"""
    prof = _get_or_create(db, int(me.id or 0))

    # 空字符串统一存成 None，避免"有值但看起来是空的"
    for key, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        if value is None and key not in ("is_public",):
            setattr(prof, key, None)
        else:
            setattr(prof, key, value)

    prof.updated_at = utcnow()
    db.add(prof)
    db.commit()
    db.refresh(prof)

    logger.info("[资料] %s 更新了自己的关于页信息", me.username)
    return _to_read(prof, me)

# ============================================================
# 我自己的 GitHub 账号（成员在「项目管理」里填）
# ============================================================
#
# 为什么放在这里而不是「成员管理」：
#   GitHub 账号是**成员自己的凭据**，属于个人设置；
#   管理员只负责授权"能不能用 GitHub 同步"（admin.github_enabled）。
#   两边职责分开，管理员的站点级配置和成员的个人配置互不干扰。


class MyGithubRead(BaseModel):
    username: str | None = None
    has_token: bool = False


class MyGithubWrite(BaseModel):
    username: str | None = Field(default=None, max_length=100)
    # 留空表示不修改已有 token
    token: str | None = Field(default=None, max_length=255)


@router.get("/my-github", response_model=MyGithubRead)
def get_my_github(
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """读自己填的 GitHub 账号。token 只回 has_token，不回明文。"""
    me = db.get(Admin, admin.id)
    if me is None:
        raise HTTPException(status_code=404, detail="账号不存在")
    return MyGithubRead(
        username=me.github_username,
        has_token=bool(me.github_token),
    )


@router.put("/my-github", response_model=MyGithubRead)
def save_my_github(
    payload: MyGithubWrite,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """保存自己的 GitHub 用户名 / Token。"""
    me = db.get(Admin, admin.id)
    if me is None:
        raise HTTPException(status_code=404, detail="账号不存在")

    me.github_username = (payload.username or "").strip() or None
    if payload.token is not None and payload.token.strip():
        me.github_token = payload.token.strip()
    db.add(me)
    db.commit()
    db.refresh(me)

    logger.info("[GitHub] %s 更新了自己的 GitHub 账号", me.username)
    return MyGithubRead(
        username=me.github_username,
        has_token=bool(me.github_token),
    )


# ============================================================
# 我自己的网易云账号（成员在「音乐管理」里填）
# ============================================================
#
# 和 GitHub 账号的处理方式一致：
#   凭据是成员自己的，管理员只授权能不能用（admin.netease_enabled）。
#   填了之后，网易云相关请求会优先用这个 cookie（见 deps.use_my_music_u），
#   没有才回落到站点配置里站长的那份。


class MyNeteaseRead(BaseModel):
    has_cookie: bool = False


class MyNeteaseWrite(BaseModel):
    # 留空表示不修改已有 cookie
    cookie: str | None = Field(default=None, max_length=500)


@router.get("/my-netease", response_model=MyNeteaseRead)
def get_my_netease(
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """只看有没有配，不回 cookie 明文（那等同于账号凭据）。"""
    me = db.get(Admin, admin.id)
    if me is None:
        raise HTTPException(status_code=404, detail="账号不存在")
    return MyNeteaseRead(has_cookie=bool(me.netease_cookie))


@router.put("/my-netease", response_model=MyNeteaseRead)
def save_my_netease(
    payload: MyNeteaseWrite,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """保存自己的网易云 MUSIC_U。留空表示不修改。"""
    me = db.get(Admin, admin.id)
    if me is None:
        raise HTTPException(status_code=404, detail="账号不存在")

    raw = (payload.cookie or "").strip()
    if raw:
        # 允许直接粘贴整段 cookie，这里只取 MUSIC_U=... 的值
        if "MUSIC_U=" in raw:
            raw = raw.split("MUSIC_U=", 1)[1].split(";", 1)[0].strip()
        me.netease_cookie = raw or None
        db.add(me)
        db.commit()
        db.refresh(me)
        logger.info("[网易云] %s 更新了自己的 MUSIC_U", me.username)

    return MyNeteaseRead(has_cookie=bool(me.netease_cookie))
