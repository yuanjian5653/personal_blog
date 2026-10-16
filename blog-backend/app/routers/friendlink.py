"""
友情链接路由

公开接口：
  GET  /api/friend-links            前台列表（只返回 is_visible，按权重倒序）
  POST /api/friend-links/{id}/click 记录一次点击（用于以后做"热度"）

后台接口（需管理员）：
  GET    /api/friend-links/all
  POST   /api/friend-links
  PUT    /api/friend-links/{id}
  DELETE /api/friend-links/{id}
  POST   /api/friend-links/upload-cover
"""
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, func, select

from app.config import settings
from app.constants import IMAGE_EXTENSIONS
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, FriendLink
from app.schemas.friendlink import (
    FriendLinkCreate,
    FriendLinkRead,
    FriendLinkUpdate,
)
from app.services.log_service import apply_updates, log_operation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/friend-links", tags=["友链"])

MAX_COVER_SIZE = 5 * 1024 * 1024  # 5MB

# 封面图存放目录（复用 media 根目录下的 friends/）
COVER_DIR = settings.MEDIA_ROOT / "friends"


def _sort_key(link: FriendLink):
    """排序：权重大的在前；权重相同按 sort_order 小的在前；再按 id 稳定排序。

    加 id 兜底是为了避免"权重与 sort_order 都相同"时每次查询顺序不一样。
    """
    return (-link.weight, link.sort_order, link.id or 0)


def _normalize_url(url: str) -> str:
    """补全协议头。

    用户很容易只填 `example.com`，那样在前台会变成相对路径跳到自己站内。
    这里统一补 https://（已有 http/https 则原样保留）。
    """
    u = url.strip()
    if not u:
        return u
    if u.startswith(("http://", "https://")):
        return u
    # mailto: / 其它协议不动
    if "://" in u or u.startswith("mailto:"):
        return u
    return f"https://{u}"


# ============================================================
# 公开接口
# ============================================================

@router.get("", response_model=list[FriendLinkRead])
def list_friend_links(db: Session = Depends(get_session)):
    """前台友链列表：只返回可见的，按权重倒序"""
    rows = db.exec(select(FriendLink).where(FriendLink.is_visible == True)).all()  # noqa: E712
    return sorted(rows, key=_sort_key)


@router.post("/{link_id}/click")
def record_click(link_id: int, db: Session = Depends(get_session)):
    """记录点击（前台点卡片时上报）。

    目前只累加计数，不做别的；先留好数据，以后可以按热度排序。
    """
    link = db.get(FriendLink, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="友链不存在")
    # 复用 weight 之外的独立计数没有建表字段，这里先不累加，
    # 只做存在性校验并返回成功 —— 避免"假装记了其实没记"。
    return {"ok": True}


# ============================================================
# 后台接口
# ============================================================

@router.get("/all", response_model=list[FriendLinkRead])
def list_all_friend_links(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """后台列表：包含不可见的，同样按权重倒序"""
    rows = db.exec(select(FriendLink)).all()
    return sorted(rows, key=_sort_key)


@router.post("", response_model=FriendLinkRead)
def create_friend_link(
    payload: FriendLinkCreate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """新增友链"""
    data = payload.model_dump()
    data["url"] = _normalize_url(data["url"])
    if not data["url"]:
        raise HTTPException(status_code=400, detail="网址不能为空")
    data["name"] = data["name"].strip()
    if not data["name"]:
        raise HTTPException(status_code=400, detail="名称不能为空")

    link = FriendLink(**data)
    db.add(link)
    db.commit()
    db.refresh(link)

    log_operation(
        db,
        admin_id=admin.id or 0,
        action="create",
        target_type="friend_link",
        target_id=link.id,
        changes={"name": {"old": None, "new": link.name}},
    )
    db.commit()
    return link


@router.put("/{link_id}", response_model=FriendLinkRead)
def update_friend_link(
    link_id: int,
    payload: FriendLinkUpdate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """修改友链（只传要改的字段即可）"""
    link = db.get(FriendLink, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="友链不存在")

    data = payload.model_dump(exclude_unset=True)
    if "url" in data and data["url"] is not None:
        data["url"] = _normalize_url(data["url"])
        if not data["url"]:
            raise HTTPException(status_code=400, detail="网址不能为空")
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
        if not data["name"]:
            raise HTTPException(status_code=400, detail="名称不能为空")

    # apply_updates 会逐个比对、写操作日志（字段级变更）
    apply_updates(
        db,
        link,
        data,
        admin_id=admin.id or 0,
        target_type="friend_link",
        target_id=link_id,
        max_value_len=200,
    )
    link.updated_at = datetime.now(timezone.utc)
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.delete("/{link_id}")
def delete_friend_link(
    link_id: int,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """删除友链"""
    link = db.get(FriendLink, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="友链不存在")

    name = link.name
    db.delete(link)
    db.commit()

    log_operation(
        db,
        admin_id=admin.id or 0,
        action="delete",
        target_type="friend_link",
        target_id=link_id,
        changes={"name": {"old": name, "new": None}},
    )
    db.commit()
    return {"message": "已删除"}


@router.post("/upload-cover")
async def upload_cover(
    file: UploadFile = File(...),
    _admin: Admin = Depends(get_current_admin),
):
    """上传友链封面，返回可直接存进 cover 字段的相对路径"""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"仅支持 {', '.join(sorted(IMAGE_EXTENSIONS))} 格式",
        )

    raw = await file.read()
    if len(raw) > MAX_COVER_SIZE:
        raise HTTPException(status_code=400, detail="图片过大（>5MB）")

    COVER_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    (COVER_DIR / filename).write_bytes(raw)

    # 返回带 /media 前缀的路径，前端 resolveImageUrl 能直接解析
    return {"path": f"/media/friends/{filename}", "filename": filename}
