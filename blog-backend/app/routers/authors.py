"""
公开作者表

前端列表里的内容只带 `author_id`，显示名和头像需要另一份映射。
单独做一个很小的接口，前端启动时取一次缓存起来，
这样就不用为了作者徽章去改每个内容接口的序列化逻辑（也就不会有 N+1）。

只暴露展示所需的最小信息：id / 显示名 / 头像 / 是否管理员。
**不含**登录名之外的任何凭据信息，也不含列表以外的账号。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models import Admin, Article, AuthorProfile, Essay, LifePost, SiteConfig
from app.models.admin import ROLE_ADMIN, STATUS_ACTIVE

router = APIRouter(prefix="/api/authors", tags=["作者"])


class AuthorPublic(BaseModel):
    id: int
    name: str
    avatar: str | None = None
    is_admin: bool = False
    # 是否已公开发布过内容（前端可据此只在真的作者身上显示徽章）
    has_content: bool = False


def _site_author_name(db: Session) -> str | None:
    """站长在「关于内容」里填的昵称（site_config.author_name）。"""
    row = db.exec(
        select(SiteConfig).where(SiteConfig.config_key == "author_name")
    ).first()
    cfg = row if isinstance(row, SiteConfig) else (row[0] if row else None)
    if cfg is None:
        return None
    return (cfg.config_value or "").strip() or None


def _profile_nicknames(db: Session) -> dict[int, str]:
    """每个账号在关于页里设置的昵称。"""
    rows = db.exec(select(AuthorProfile)).all()
    out: dict[int, str] = {}
    for r in rows:
        prof = r if isinstance(r, AuthorProfile) else r[0]
        if isinstance(prof, AuthorProfile) and prof.nickname:
            name = prof.nickname.strip()
            if name:
                out[prof.admin_id] = name
    return out


@router.get("", response_model=list[AuthorPublic])
def list_authors(db: Session = Depends(get_session)):
    """所有启用中的后台账号（用作作者徽章的显示名来源）。"""
    rows = db.exec(
        select(Admin).where(Admin.status == STATUS_ACTIVE).order_by(Admin.id)
    ).all()
    admins = [r if isinstance(r, Admin) else r[0] for r in rows]
    admins = [a for a in admins if isinstance(a, Admin)]

    nicknames = _profile_nicknames(db)
    site_name = _site_author_name(db)

    out: list[AuthorPublic] = []
    for a in admins:
        aid = int(a.id or 0)
        # 有任意一篇已发布内容就算"有作品"
        has = False
        for model in (Article, Essay, LifePost):
            stmt = select(model.id).where(model.author_id == aid)
            if model is Article:
                stmt = stmt.where(Article.status == "published")
            if db.exec(stmt.limit(1)).first() is not None:
                has = True
                break

        # 昵称优先级：个人档案 → 站长关于页 → 显示名 → 用户名
        # 你要求"作者标签显示关于页里设置的昵称"，所以档案和 site_config 排前面
        if aid in nicknames:
            display = nicknames[aid]
        elif a.role == ROLE_ADMIN and site_name:
            display = site_name
        else:
            display = a.shown_name

        out.append(
            AuthorPublic(
                id=aid,
                name=display,
                avatar=None,
                is_admin=a.role == ROLE_ADMIN,
                has_content=has,
            )
        )
    return out
