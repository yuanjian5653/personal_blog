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
from app.deps import get_current_staff
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
