"""
成员公开页（阶段 3）

  GET /api/members            成员列表（站长始终在其中，成员需 is_public=true）
  GET /api/members/{username} 单个成员的关于页数据

只暴露展示所需的信息：昵称、头像、简介、社交链接、关于页正文。
**不含**登录名以外的任何凭据信息，也不列未公开的账号。

站长的数据回落规则（档案为空时）：
  · 昵称 / 简介 / 头像 / 社交链接 → 站点「关于内容」里的那套（author_* / social_*）
  · 关于页正文（about_*）        → 站点「关于内容」里的 about_subtitle/banner/content
  · **不回落**「网站介绍」（site_intro_*）—— 那是 /about 的网站介绍，不是站长个人页
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


class MemberCounts(BaseModel):
    articles: int = 0
    essays: int = 0
    life: int = 0
    albums: int = 0


class MemberPublicItem(BaseModel):
    username: str
    name: str
    avatar: str | None = None
    bio: str | None = None
    # 社交链接：首页个人卡片轮播时也要跟着切换
    social_github: str | None = None
    social_email: str | None = None
    social_telegram: str | None = None
    social_discord: str | None = None
    # 这个人的作品数量（轮播时数字要跟着变，不能是全站总数）
    counts: MemberCounts = MemberCounts()


class MemberPublicDetail(MemberPublicItem):
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


def _counts_for(db: Session, admin_id: int) -> MemberCounts:
    """某个人的作品数量（只算已发布且过审的，和前台看到的一致）。"""
    from sqlalchemy import text

    conn = db.connection()

    def count(table: str, public_only: bool) -> int:
        sql = f"SELECT COUNT(*) FROM {table} WHERE author_id = :a"
        if public_only:
            sql += " AND status = 'published' AND review_status IN ('none', 'approved')"
        return int(conn.execute(text(sql), {"a": admin_id}).scalar() or 0)

    return MemberCounts(
        articles=count("articles", True),
        essays=count("essays", True),
        life=count("life_posts", True),
        albums=count("albums", False),
    )


def _public_rows(db: Session):
    """站长始终公开；成员需 is_public=true。"""
    profiles = _profiles(db)
    rows = db.exec(select(Admin).where(Admin.status == STATUS_ACTIVE)).all()
    admins = [r if isinstance(r, Admin) else r[0] for r in rows]
    for a in admins:
        if not isinstance(a, Admin):
            continue
        prof = profiles.get(int(a.id or 0))
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

    out: list[MemberPublicItem] = []
    for a, prof in _public_rows(db):
        is_site_owner = a.role == ROLE_ADMIN
        p = prof

        def f(attr: str):
            """成员读档案；站长读档案、为空回落站点「关于内容」的对应键。"""
            key = {
                "nickname": "author_name",
                "avatar_url": "author_avatar",
                "bio": "author_bio",
                "social_github": "social_github",
                "social_email": "social_email",
                "social_telegram": "social_telegram",
                "social_discord": "social_discord",
            }[attr]
            v = getattr(p, attr, None) if p else None
            if v:
                return v
            return (cfg.get(key) or None) if is_site_owner else None

        out.append(
            MemberPublicItem(
                username=a.username,
                name=(f("nickname") or "").strip() or a.shown_name,
                avatar=f("avatar_url"),
                bio=f("bio"),
                social_github=f("social_github"),
                social_email=f("social_email"),
                social_telegram=f("social_telegram"),
                social_discord=f("social_discord"),
                counts=_counts_for(db, int(a.id or 0)),
            )
        )

    out.sort(key=lambda m: 0 if m.name == site_name else 1)
    return out


@router.get("/{username}", response_model=MemberPublicDetail)
def get_member(username: str, db: Session = Depends(get_session)):
    """单个成员的关于页。未公开或不存在一律 404（不暴露存在性）。"""
    cfg = get_all_configs(db)
    site_name = (cfg.get("author_name") or "").strip()

    for a, prof in _public_rows(db):
        if a.username != username:
            continue
        is_site_owner = a.role == ROLE_ADMIN
        p = prof

        def f(attr: str):
            key = {
                "nickname": "author_name",
                "avatar_url": "author_avatar",
                "bio": "author_bio",
                "social_github": "social_github",
                "social_email": "social_email",
                "social_telegram": "social_telegram",
                "social_discord": "social_discord",
                "about_subtitle": "about_subtitle",
                "about_banner": "about_banner",
                "about_content": "about_content",
            }[attr]
            v = getattr(p, attr, None) if p else None
            if v:
                return v
            return (cfg.get(key) or None) if is_site_owner else None

        return MemberPublicDetail(
            username=a.username,
            name=(f("nickname") or "").strip() or a.shown_name,
            avatar=f("avatar_url"),
            bio=f("bio"),
            social_github=f("social_github"),
            social_email=f("social_email"),
            social_telegram=f("social_telegram"),
            social_discord=f("social_discord"),
            # 站长个人介绍来自「关于内容」的 about_*；不回落到网站介绍
            about_subtitle=f("about_subtitle"),
            about_banner=f("about_banner"),
            about_content=f("about_content"),
            is_admin=is_site_owner,
        )

    raise HTTPException(status_code=404, detail="没有这个成员")
