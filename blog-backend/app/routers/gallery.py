"""
图库管理：看清 media/photos 里都有什么、谁在用、多少是孤儿。

为什么需要：
    图片上传是"只进不出"的 —— 换封面、删文章、改头像之后，
    旧图还躺在磁盘上。时间一长 photos 目录几十上百 MB，
    但真正还在用的可能只有一半。

核心是一个**保守的引用检测**：
    把所有可能存图片路径的地方扫一遍（文章封面、相册、生活照片、
    文章内嵌、头像、背景图、主题背景、歌单封面、表情包素材……），
    路径统一成 basename 后建集合。
    **只要有任何一处引用，就不算孤儿** —— 宁可漏报，绝不误删。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlmodel import Session

from app.config import settings
from app.database import get_session
from app.deps import require_admin_role
from app.models import (
    Admin,
    Album,
    Article,
    AuthorProfile,
    Comment,
    Commenter,
    EasterEgg,
    Essay,
    FriendLink,
    LifePost,
    MemberTheme,
    Photo,
    Playlist,
    ReplyNotification,
    SiteConfig,
    Song,
)

router = APIRouter(prefix="/api/admin/gallery", tags=["图库管理"])

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".svg"}


# ============================================================
# 引用检测
# ============================================================
def _basename(value: str) -> str | None:
    """把各种写法统一成"文件名"。

    库里存的可能是：
        /media/photos/abc.jpg
        abc.jpg
        https://cdn.example.com/media/photos/abc.jpg
        /media/photos/abc.jpg?w=800
    """
    if not value or not isinstance(value, str):
        return None
    v = value.strip()
    if not v:
        return None
    # 去掉查询串和锚点
    v = v.split("?", 1)[0].split("#", 1)[0]
    v = v.rstrip("/")
    name = v.rsplit("/", 1)[-1]
    if not name or "." not in name:
        return None
    if Path(name).suffix.lower() not in IMAGE_EXTS:
        return None
    return name


def _collect(value, out: set[str]) -> None:
    """把一个字段里可能藏着的图片名全挖出来（支持 JSON 字符串 / 列表 / dict）。"""
    if value is None:
        return
    if isinstance(value, str):
        # 先当普通字符串试一次
        name = _basename(value)
        if name:
            out.add(name)
        # 再当 JSON 试（essay.images / life.images 存的是 JSON 数组）
        s = value.strip()
        if s.startswith(("[", "{")):
            try:
                _collect(json.loads(s), out)
            except (ValueError, TypeError):
                pass
        # 最后用正则捞一遍字符串里的图片路径（比如正文里内嵌的 ![](..)）
        for m in re.finditer(r"[\w\-./%]+?\.(?:jpe?g|png|gif|webp|avif|bmp|svg)", value, re.I):
            n = _basename(m.group(0))
            if n:
                out.add(n)
        return
    if isinstance(value, (list, tuple, set)):
        for item in value:
            _collect(item, out)
        return
    if isinstance(value, dict):
        for item in value.values():
            _collect(item, out)


def referenced_names(db: Session) -> set[str]:
    """全库被引用到的图片文件名。"""
    out: set[str] = set()

    def scan(model, *columns):
        rows = db.exec(select(model)).all()
        for r in rows:
            obj = r if isinstance(r, model) else r[0]
            if not isinstance(obj, model):
                continue
            for col in columns:
                _collect(getattr(obj, col, None), out)

    scan(Article, "cover_path", "content")
    scan(Essay, "images", "content")
    scan(LifePost, "images", "content")
    scan(Album, "cover_path", "file_path", "description")
    # Photo 才是相册里的照片本体。漏了它会把整个相册误判成孤儿 ——
    # 一键清理就等于删用户的相册。这是最要命的一处。
    scan(Photo, "file_path")
    scan(AuthorProfile, "avatar_url")
    scan(Comment, "author_avatar", "avatar_url")
    scan(Commenter, "avatar_url")
    scan(EasterEgg, "asset_path")
    scan(FriendLink, "cover")
    scan(MemberTheme, "bg_image")
    scan(Song, "cover_path")
    scan(Playlist, "cover_path")
    scan(ReplyNotification, "actor_avatar")

    # site_config 是一堆 key/value，全都扫一遍（头像、背景、介绍配图都在这）
    for r in db.exec(select(SiteConfig)).all():
        cfg = r if isinstance(r, SiteConfig) else r[0]
        if isinstance(cfg, SiteConfig):
            _collect(cfg.config_value, out)

    return out


# ============================================================
# 列表
# ============================================================
class GalleryItem(BaseModel):
    name: str
    url: str
    size: int
    modified: float
    referenced: bool
    thumb: str | None = None


class GalleryStats(BaseModel):
    total: int
    total_size: int
    orphans: int
    orphan_size: int
    referenced: int


def _scan_dir() -> list[dict]:
    d = settings.PHOTO_DIR
    if not d.exists():
        return []
    items = []
    for p in d.iterdir():
        if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS:
            continue
        st = p.stat()
        items.append(
            {
                "name": p.name,
                "url": f"/media/photos/{p.name}",
                "size": st.st_size,
                "modified": st.st_mtime,
            }
        )
    items.sort(key=lambda x: x["modified"], reverse=True)
    return items


@router.get("", response_model=list[GalleryItem])
def list_gallery(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(require_admin_role),
    only_orphan: bool = Query(default=False),
):
    """列出 photos 目录里的图片，并标注有没有被引用。

    only_orphan=true 只返回孤儿（没人引用的），方便直接清理。
    """
    used = referenced_names(db)
    thumb_dir = settings.PHOTO_DIR.parent / "thumbs"

    result: list[GalleryItem] = []
    for item in _scan_dir():
        ref = item["name"] in used
        if only_orphan and ref:
            continue
        thumb_name = f"{Path(item['name']).stem}.jpg"
        thumb = f"/media/thumbs/{thumb_name}" if (thumb_dir / thumb_name).exists() else None
        result.append(GalleryItem(**item, referenced=ref, thumb=thumb))
    return result


@router.get("/stats", response_model=GalleryStats)
def gallery_stats(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(require_admin_role),
):
    used = referenced_names(db)
    items = _scan_dir()
    total_size = sum(i["size"] for i in items)
    orphans = [i for i in items if i["name"] not in used]
    return GalleryStats(
        total=len(items),
        total_size=total_size,
        orphans=len(orphans),
        orphan_size=sum(i["size"] for i in orphans),
        referenced=len(items) - len(orphans),
    )


# ============================================================
# 删除
# ============================================================
class CleanupRequest(BaseModel):
    """dry_run=true 只报告会删什么，不真删。"""
    names: list[str] | None = None   # 指定文件名；不传 = 全部孤儿
    dry_run: bool = True


class CleanupResult(BaseModel):
    deleted: list[str]
    skipped: list[str]
    freed: int


def _safe_target(name: str) -> Path | None:
    """只允许删 photos 目录下的文件名，挡住 ../ 之类的路径穿越。"""
    if not name or "/" in name or "\\" in name or ".." in name:
        return None
    p = settings.PHOTO_DIR / name
    if p.suffix.lower() not in IMAGE_EXTS:
        return None
    try:
        if p.resolve().parent != settings.PHOTO_DIR.resolve():
            return None
    except OSError:
        return None
    return p if p.is_file() else None


@router.post("/cleanup", response_model=CleanupResult)
def cleanup_gallery(
    payload: CleanupRequest,
    db: Session = Depends(get_session),
    admin: Admin = Depends(require_admin_role),
):
    """清理图片。默认 dry_run —— 只告诉你会删哪些、能腾多少空间。

    被引用的图片**永不删除**：即使你在 names 里点名，也会被跳过并回报。
    """
    used = referenced_names(db)

    if payload.names is None:
        targets = [i["name"] for i in _scan_dir() if i["name"] not in used]
    else:
        targets = payload.names

    deleted: list[str] = []
    skipped: list[str] = []
    freed = 0

    thumb_dir = settings.PHOTO_DIR.parent / "thumbs"

    for name in targets:
        if name in used:
            skipped.append(name)
            continue
        p = _safe_target(name)
        if p is None:
            skipped.append(name)
            continue
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        if not payload.dry_run:
            try:
                p.unlink()
                # 顺手删掉对应缩略图，否则 thumbs 会一直涨
                thumb = thumb_dir / f"{Path(name).stem}.jpg"
                if thumb.exists():
                    thumb.unlink(missing_ok=True)
            except OSError:
                skipped.append(name)
                continue
        deleted.append(name)
        freed += size

    if deleted and not payload.dry_run:
        from app.services.log_service import log_operation

        log_operation(
            db,
            admin_id=admin.id or 0,
            action="cleanup",
            target_type="gallery",
            target_id=None,
            changes={"deleted": len(deleted), "freed": freed},
        )
        db.commit()

    return CleanupResult(deleted=deleted, skipped=skipped, freed=freed)
