"""
成员公开页（阶段 3）

  GET /api/members            成员列表（只列 is_public=true 且 active 的）
  GET /api/members/{username} 单个成员的关于页数据

只暴露展示所需的信息：昵称、头像、简介、社交链接、关于页正文。
**不含**登录名以外的任何凭据信息，也不列未公开的账号。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models import Admin, AuthorProfile
from app.models.admin import ROLE_ADMIN, STATUS_ACTIVE
from app.services.site_config import get_all_configs

router = APIRouter(prefix="/api/members", tags=["成员（公开）"])


class MemberPublicItem(BaseModel):
    username: str
    name: str
    avatar: str | None = None
    bio: str | None = None


class MemberPublicDetail(MemberPublicItem):
    social_github: str | None = None
    social_email: str | None = None
    social_telegram: str | None = None
    social_discord: str | None = None
    about_subtitle: str | None = None
    about_banner: str | None = None
    about_content: str | None = None
    is_admin: bool = False


def _profiles(db: Session) -> dict[int, AuthorProfile]:
    rows = db.exec(select(AuthorProfile)).all()
    out: dict[int, AuthorProfile] = {}
    for r in rows:
        p = r if isinstance(r, AuthorProfile) else r[0]
        if isinstance(p, AuthorProfile):
            out[p.admin_id] = p
    return out


def _public_rows(db: Session):
    """is_public=true 且 active 的账号 + 其档案。"""
    profiles = _profiles(db)
    rows = db.exec(select(Admin).where(Admin.status == STATUS_ACTIVE)).all()
    admins = [r if isinstance(r, Admin) else r[0] for r in rows]
    for a in admins:
        if not isinstance(a, Admin):
            continue
        prof = profiles.get(int(a.id or 0))

        # 站长的关于页**始终公开** —— 它就是这个站的"主人页"，
        # 不该要求 ta 自己去勾一个"公开我"的开关。
        # 成员则必须自己打开 is_public。
        if a.role == ROLE_ADMIN:
            yield a, prof
            continue

        if prof is None or not prof.is_public:
            continue
        yield a, prof


@router.get("", response_model=list[MemberPublicItem])
def list_members(db: Session = Depends(get_session)):
    """公开的成员列表。"""
    cfg = get_all_configs(db)
    site_name = (cfg.get("author_name") or "").strip()
    site_bio = (cfg.get("author_bio") or "").strip()
    site_about_subtitle = (cfg.get("about_subtitle") or "").strip() or None
    site_about_banner = (cfg.get("about_banner") or "").strip() or None
    site_about_content = (cfg.get("about_content") or "").strip() or None
    # 管理员的社交链接也存在 site_config（关于内容页里填的），档案为空时回落
    site_social_github = (cfg.get("social_github") or "").strip() or None
    site_social_email = (cfg.get("social_email") or "").strip() or None
    site_social_telegram = (cfg.get("social_telegram") or "").strip() or None
    site_social_discord = (cfg.get("social_discord") or "").strip() or None

    out: list[MemberPublicItem] = []
    for a, prof in _public_rows(db):
        is_site_owner = a.role == ROLE_ADMIN
        out.append(
            MemberPublicItem(
                username=a.username,
                name=((prof.nickname if prof else None) or "").strip()
                or (site_name if is_site_owner else "")
                or a.shown_name,
                avatar=(prof.avatar_url if prof else None),
                bio=(prof.bio if prof else None) or (site_bio if is_site_owner else None),
            )
        )
    # 管理员排前面
    out.sort(key=lambda m: 0 if m.name == site_name else 1)
    return out


@router.get("/{username}", response_model=MemberPublicDetail)
def get_member(username: str, db: Session = Depends(get_session)):
    """单个成员的关于页。未公开或不存在一律 404（不暴露存在性）。"""
    cfg = get_all_configs(db)
    site_name = (cfg.get("author_name") or "").strip()
    site_bio = (cfg.get("author_bio") or "").strip()
    site_about_subtitle = (cfg.get("about_subtitle") or "").strip() or None
    site_about_banner = (cfg.get("about_banner") or "").strip() or None
    site_about_content = (cfg.get("about_content") or "").strip() or None

    for a, prof in _public_rows(db):
        if a.username != username:
            continue
        is_site_owner = a.role == ROLE_ADMIN
        prof = prof  # 管理员可能没有档案
        return MemberPublicDetail(
            username=a.username,
            name=((prof.nickname if prof else None) or "").strip()
            or (site_name if is_site_owner else "")
            or a.shown_name,
            avatar=prof.avatar_url,
            bio=prof.bio or (site_bio if is_site_owner else None),
            social_github=(prof.social_github if prof else None)
            or (site_social_github if is_site_owner else None),
            social_email=(prof.social_email if prof else None)
            or (site_social_email if is_site_owner else None),
            social_telegram=(prof.social_telegram if prof else None)
            or (site_social_telegram if is_site_owner else None),
            social_discord=(prof.social_discord if prof else None)
            or (site_social_discord if is_site_owner else None),
            # 管理员档案为空时，用站点「关于内容」里的那套
            # （也就是以前 /about 显示的个人介绍）
            about_subtitle=(prof.about_subtitle if prof else None)
            or (site_about_subtitle if is_site_owner else None),
            about_banner=(prof.about_banner if prof else None)
            or (site_about_banner if is_site_owner else None),
            about_content=(prof.about_content if prof else None)
            or (site_about_content if is_site_owner else None),
            is_admin=is_site_owner,
        )

    raise HTTPException(status_code=404, detail="没有这个成员")
