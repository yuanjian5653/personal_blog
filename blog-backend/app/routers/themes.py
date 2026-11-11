"""
主题接口。

前台（公开）
    GET /api/themes                 已上线的成员主题列表（供切换器使用）

成员自己
    GET /api/admin/my-theme         读自己的主题（没有就返回默认值，不落库）
    PUT /api/admin/my-theme         保存自己的主题

管理员
    GET /api/admin/themes           所有成员的主题（含未上线）
    PUT /api/admin/themes/{id}/publish   上线 / 下线

站长的默认主题仍然在 site_config 里（后台「站点配置 → 主题与背景」），
这里只管理"成员额外提供的可选主题"。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_admin, require_admin_role
from app.models import Admin, MemberTheme
from app.models._base import utcnow
from app.services.log_service import log_operation

logger = logging.getLogger(__name__)

router = APIRouter(tags=["主题"])


# ============================================================
# 数据结构
# ============================================================

class ThemePayload(BaseModel):
    """一套主题的全部可变字段。"""

    name: str = Field(default="我的主题", max_length=50)

    theme_accent: str = Field(default="#7c5cff", max_length=20)
    bg_type: str = Field(default="color", max_length=20)
    bg_color: str = Field(default="#0f1115", max_length=20)
    bg_image: str = Field(default="", max_length=500)
    bg_blur: int = Field(default=0, ge=0, le=60)
    bg_overlay: float = Field(default=0.0, ge=0, le=1)
    card_text: str = Field(default="", max_length=2000)
    card_wave_color1: str = Field(default="#7c5cff", max_length=20)
    card_wave_color2: str = Field(default="#4cc9f0", max_length=20)
    home_album_id: int | None = None


class ThemeOut(ThemePayload):
    admin_id: int
    owner_name: str
    is_published: bool
    updated_at: str | None = None


def _to_out(theme: MemberTheme, owner: Admin | None) -> ThemeOut:
    return ThemeOut(
        admin_id=theme.admin_id,
        owner_name=(owner.shown_name if owner else "未知"),
        is_published=theme.is_published,
        updated_at=theme.updated_at.isoformat() if theme.updated_at else None,
        name=theme.name,
        theme_accent=theme.theme_accent,
        bg_type=theme.bg_type,
        bg_color=theme.bg_color,
        bg_image=theme.bg_image,
        bg_blur=theme.bg_blur,
        bg_overlay=theme.bg_overlay,
        card_text=theme.card_text,
        card_wave_color1=theme.card_wave_color1,
        card_wave_color2=theme.card_wave_color2,
        home_album_id=theme.home_album_id,
    )


def _owners(db: Session) -> dict[int, Admin]:
    rows = db.exec(select(Admin)).all()
    out: dict[int, Admin] = {}
    for r in rows:
        a = r if isinstance(r, Admin) else r[0]
        if isinstance(a, Admin) and a.id is not None:
            out[int(a.id)] = a
    return out


def _themes(db: Session) -> list[MemberTheme]:
    rows = db.exec(select(MemberTheme)).all()
    out: list[MemberTheme] = []
    for r in rows:
        t = r if isinstance(r, MemberTheme) else r[0]
        if isinstance(t, MemberTheme):
            out.append(t)
    return out


# ============================================================
# 前台：可切换的主题
# ============================================================

@router.get("/api/themes", response_model=list[ThemeOut])
def list_published_themes(db: Session = Depends(get_session)):
    """已经上线的主题。

    这里**不含**站长的默认主题 —— 那一套由 /api/site-config 提供，
    前端把它当成第一个选项。这样站长的配置改了立即生效，不用同步两份。
    """
    owners = _owners(db)
    out: list[ThemeOut] = []
    for t in _themes(db):
        if not t.is_published:
            continue
        owner = owners.get(t.admin_id)
        # 账号被停用后它的主题也不该再露出来
        if owner is None or getattr(owner, "status", "active") != "active":
            continue
        out.append(_to_out(t, owner))
    out.sort(key=lambda x: x.owner_name)
    return out


# ============================================================
# 成员自己的主题
# ============================================================

@router.get("/api/admin/my-theme", response_model=ThemeOut)
def get_my_theme(
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """读自己的主题；还没存过就返回一份默认值（不写库）。"""
    me = db.get(Admin, admin.id)
    rows = _themes(db)
    mine = next((t for t in rows if t.admin_id == (admin.id or 0)), None)
    if mine is not None:
        return _to_out(mine, me)

    return ThemeOut(
        admin_id=int(admin.id or 0),
        owner_name=(me.shown_name if me else admin.username),
        is_published=False,
        updated_at=None,
    )


@router.put("/api/admin/my-theme", response_model=ThemeOut)
def save_my_theme(
    payload: ThemePayload,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """保存自己的主题。

    注意：**已上线的主题也可以继续改**，改完立即对新访客生效。
    如果要临时下线，找管理员点"下线"。
    """
    rows = _themes(db)
    mine = next((t for t in rows if t.admin_id == (admin.id or 0)), None)
    if mine is None:
        mine = MemberTheme(admin_id=int(admin.id or 0))
        db.add(mine)

    for k, v in payload.model_dump().items():
        setattr(mine, k, v)
    mine.updated_at = utcnow()

    log_operation(
        db,
        int(admin.id or 0),
        "update",
        "member_theme",
        None,
        changes={"name": {"old": None, "new": payload.name}},
    )
    db.commit()
    db.refresh(mine)
    me = db.get(Admin, admin.id)
    return _to_out(mine, me)


# ============================================================
# 管理员：查看全部 + 上线开关
# ============================================================

@router.get("/api/admin/themes", response_model=list[ThemeOut])
def list_all_themes(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(require_admin_role),
):
    """所有成员的主题，含未上线的。"""
    owners = _owners(db)
    out = [
        _to_out(t, owners.get(t.admin_id))
        for t in _themes(db)
        if t.admin_id in owners
    ]
    out.sort(key=lambda x: (not x.is_published, x.owner_name))
    return out


class PublishPayload(BaseModel):
    is_published: bool


@router.put("/api/admin/themes/{admin_id}/publish", response_model=ThemeOut)
def publish_theme(
    admin_id: int,
    payload: PublishPayload,
    db: Session = Depends(get_session),
    admin: Admin = Depends(require_admin_role),
):
    """上线 / 下线某个成员的主题。"""
    theme = None
    for t in _themes(db):
        if t.admin_id == admin_id:
            theme = t
            break
    if theme is None:
        raise HTTPException(status_code=404, detail="这个成员还没有设置主题")

    theme.is_published = payload.is_published
    theme.updated_at = utcnow()
    db.add(theme)

    log_operation(
        db,
        int(admin.id or 0),
        "publish" if payload.is_published else "unpublish",
        "member_theme",
        theme.id,
        changes={"is_published": {"old": not payload.is_published, "new": payload.is_published}},
    )
    db.commit()
    db.refresh(theme)

    logger.info(
        "[主题] %s %s了成员 #%s 的主题「%s」",
        admin.username,
        "上线" if payload.is_published else "下线",
        admin_id,
        theme.name,
    )
    owner = db.get(Admin, admin_id)
    return _to_out(theme, owner)
