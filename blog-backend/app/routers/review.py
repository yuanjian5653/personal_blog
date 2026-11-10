"""
审核队列（仅管理员）

  GET  /api/admin/review                待审列表（按类型分组 + 计数）
  POST /api/admin/review/{kind}/{id}    通过 / 驳回（可带理由）

  审核策略不再有全局开关 —— 它现在是每个成员自己的属性（need_review），
  在「成员管理」里逐个设置。

为什么 on{"kind"} 用路径段而不是全局 id：
    五张表各自有自增 id，光有 id 无法定位到具体是哪张表的哪条。
    kind 显式指明类型，比"猜"安全。
"""
from __future__ import annotations

import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session
from app.deps import require_admin_role
from app.models import (
    Admin,
    Article,
    Album,
    Essay,
    FriendLink,
    LifePost,
    Photo,
)
from app.models.review import REVIEW_PENDING
from app.services.review import apply_decision
from app.services.log_service import log_operation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/review", tags=["内容审核"])

ReviewKind = Literal["article", "essay", "life", "album", "photo", "friendlink"]

# kind → (模型, 用于展示标题的字段名)
KIND_MODEL: dict[str, tuple[type, str]] = {
    "article": (Article, "title"),
    "essay": (Essay, "title"),
    "life": (LifePost, "content"),
    "album": (Album, "name"),
    "photo": (Photo, "title"),
    "friendlink": (FriendLink, "name"),
}

KIND_LABEL = {
    "article": "文章",
    "essay": "说说",
    "life": "动态",
    "album": "图片组",
    "photo": "图片",
    "friendlink": "友链",
}


class PendingItem(BaseModel):
    kind: str
    kind_label: str
    id: int
    title: str
    # 正文摘要（约 160 字）—— 让管理员扫一眼就能判断，不用每次都点进去
    preview: str = ""
    # 封面/首图（文章封面、说说首图、图片组封面、友链封面）
    cover: str | None = None
    # 补充信息（友链的网址之类）
    meta: str | None = None
    author_id: int | None
    author_name: str
    created_at: str | None


class ReviewQueue(BaseModel):
    items: list[PendingItem]
    counts: dict[str, int]
    total: int


class Decision(BaseModel):
    decision: Literal["approve", "reject"]
    reason: str | None = Field(default=None, max_length=500)


def _summary(text: str | None, limit: int = 160) -> str:
    """正文摘要：压平换行，截到 limit 字。"""
    if not text:
        return ""
    flat = " ".join(str(text).split())
    return flat[:limit] + ("…" if len(flat) > limit else "")


def _first_image(raw: str | None) -> str | None:
    """images 在库里是 JSON 字符串，取第一张给列表做缩略图。"""
    if not raw:
        return None
    try:
        arr = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return arr[0] if isinstance(arr, list) and arr else None


def _preview(text: str | None, limit: int = 60) -> str:
    if not text:
        return "(无标题)"
    flat = " ".join(str(text).split())
    return flat[:limit] + ("…" if len(flat) > limit else "")


def _author_names(db: Session) -> dict[int, str]:
    rows = db.exec(select(Admin)).all()
    out: dict[int, str] = {}
    for r in rows:
        a = r if isinstance(r, Admin) else r[0]
        if isinstance(a, Admin) and a.id is not None:
            out[int(a.id)] = a.shown_name
    return out


@router.get("", response_model=ReviewQueue)
def list_pending(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(require_admin_role),
):
    """所有待审内容，按类型分组统计。"""
    names = _author_names(db)
    items: list[PendingItem] = []
    counts: dict[str, int] = {}

    for kind, (model, title_field) in KIND_MODEL.items():
        rows = db.exec(
            select(model).where(model.review_status == REVIEW_PENDING)
        ).all()
        objs = [r if isinstance(r, model) else r[0] for r in rows]
        objs = [o for o in objs if isinstance(o, model)]
        counts[kind] = len(objs)

        for o in objs:
            aid = getattr(o, "author_id", None)
            created = getattr(o, "created_at", None)

            # 每种类型能拿到的"详情"不一样，这里统一成三样：
            #   title   一行标题
            #   preview 正文摘要
            #   cover   缩略图（有就显示）
            #   meta    补充信息
            preview = ""
            cover: str | None = None
            meta: str | None = None

            if kind == "article":
                preview = _summary(getattr(o, "content", None))
                cover = getattr(o, "cover_path", None)
            elif kind == "essay":
                preview = _summary(getattr(o, "content", None))
                cover = _first_image(getattr(o, "images", None))
            elif kind == "life":
                preview = _summary(getattr(o, "content", None))
                cover = _first_image(getattr(o, "images", None))
            elif kind == "album":
                preview = _summary(getattr(o, "description", None))
                cover = getattr(o, "cover_path", None)
            elif kind == "friendlink":
                preview = _summary(getattr(o, "description", None))
                cover = getattr(o, "cover", None)
                meta = getattr(o, "url", None)

            items.append(
                PendingItem(
                    kind=kind,
                    kind_label=KIND_LABEL[kind],
                    id=int(o.id or 0),
                    title=_preview(getattr(o, title_field, None)),
                    preview=preview,
                    cover=cover,
                    meta=meta,
                    author_id=aid,
                    author_name=names.get(aid, "未知") if aid else "站长",
                    created_at=created.isoformat() if created else None,
                )
            )

    # 最新的排前面
    items.sort(key=lambda x: x.created_at or "", reverse=True)
    return ReviewQueue(
        items=items,
        counts=counts,
        total=len(items),
    )


@router.post("/{kind}/{item_id}")
def decide(
    kind: str,
    item_id: int,
    payload: Decision,
    db: Session = Depends(get_session),
    admin: Admin = Depends(require_admin_role),
):
    """通过或驳回一条内容。"""
    entry = KIND_MODEL.get(kind)
    if entry is None:
        raise HTTPException(status_code=400, detail=f"不支持的内容类型：{kind}")
    model, _ = entry

    obj = db.get(model, item_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="内容不存在")

    if getattr(obj, "review_status", None) != REVIEW_PENDING:
        raise HTTPException(
            status_code=409,
            detail=f"这条内容不在待审状态（当前 {getattr(obj, 'review_status', '?')}）",
        )

    apply_decision(obj, payload.decision)
    # 驳回时把理由落到内容上（成员在后台能看到）；通过时清空。
    obj.review_note = (
        payload.reason if payload.decision == "reject" else None
    )
    db.add(obj)

    log_operation(
        db,
        admin.id or 0,
        payload.decision,
        kind,
        item_id,
        {"reason": {"old": None, "new": payload.reason}} if payload.reason else None,
    )
    db.commit()

    logger.info(
        "[审核] %s %s了 %s #%s%s",
        admin.username,
        "通过" if payload.decision == "approve" else "驳回",
        KIND_LABEL[kind],
        item_id,
        f"（{payload.reason}）" if payload.reason else "",
    )
    return {"message": "已通过" if payload.decision == "approve" else "已驳回"}
