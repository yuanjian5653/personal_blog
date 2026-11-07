"""
暗号彩蛋路由

公开：
  POST /api/easter-eggs/check     校验暗号（**不返回暗号本身**）

后台：
  GET    /api/admin/easter-eggs           列表（含暗号）
  POST   /api/admin/easter-eggs           新建
  PUT    /api/admin/easter-eggs/{id}      修改
  DELETE /api/admin/easter-eggs/{id}      删除

为什么不给前台一个"列出所有彩蛋"的接口：
    那等于把暗号印在首页上。彩蛋的乐趣全在"猜中"，
    所以前台只能提交猜测、拿回"对/不对"。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.db_utils import model as db_model
from app.deps import get_current_admin
from app.models import Admin, EasterEgg
from app.models.easter_egg import EGG_KINDS, EGG_TRANSITIONS
from app.schemas.easter_egg import (
    EasterEggCreate,
    EasterEggRead,
    EasterEggUpdate,
    EggCheckRequest,
    EggCheckResult,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/easter-eggs", tags=["暗号彩蛋"])
admin_router = APIRouter(prefix="/api/admin/easter-eggs", tags=["暗号彩蛋管理"])


def _normalize(code: str) -> str:
    """与前端保持一致的归一化：去空白、转小写。"""
    return "".join(code.split()).lower()


def _public(row: EasterEgg) -> EggCheckResult:
    return EggCheckResult(
        egg_id=int(row.id or 0),
        name=row.name,
        hint=row.hint,
        kind=row.kind,
        asset_path=row.asset_path,
        asset_kind=row.asset_kind,
        transition=row.transition,
    )


# ============================================================
# 公开：校验暗号
# ============================================================

@router.post("/check", response_model=EggCheckResult)
def check_code(payload: EggCheckRequest, db: Session = Depends(get_session)):
    """校验用户输入的暗号。

    刻意不做"暗号不存在"和"暗号存在但已关闭"的区分 ——
    两种情况统一返回 404，避免变成"哪些暗号存在"的探测器。
    """
    want = _normalize(payload.code)
    if not want:
        raise HTTPException(status_code=404, detail="没有这个暗号")

    rows = db.exec(select(EasterEgg).where(EasterEgg.is_enabled == True)).all()  # noqa: E712
    for r in rows:
        egg = db_model(r)
        if not isinstance(egg, EasterEgg):
            continue
        if _normalize(egg.code) == want:
            logger.info("[彩蛋] 暗号命中：%s", egg.name)
            return _public(egg)

    raise HTTPException(status_code=404, detail="没有这个暗号")


# ============================================================
# 后台：增删改查
# ============================================================

@admin_router.get("", response_model=list[EasterEggRead])
def list_eggs(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    rows = db.exec(
        select(EasterEgg).order_by(EasterEgg.sort_order, EasterEgg.id)
    ).all()
    out = []
    for r in rows:
        egg = db_model(r)
        if isinstance(egg, EasterEgg):
            out.append(
                EasterEggRead(
                    id=int(egg.id or 0),
                    code=egg.code,
                    name=egg.name,
                    hint=egg.hint,
                    kind=egg.kind,
                    asset_path=egg.asset_path,
                    asset_kind=egg.asset_kind,
                    transition=egg.transition,
                    is_enabled=egg.is_enabled,
                    sort_order=egg.sort_order,
                    created_at=egg.created_at,
                    updated_at=egg.updated_at,
                )
            )
    return out


def _validate(payload_kind: str | None, payload_transition: str | None) -> None:
    if payload_kind is not None and payload_kind not in EGG_KINDS:
        raise HTTPException(status_code=400, detail=f"不支持的彩蛋类型：{payload_kind}")
    if payload_transition is not None and payload_transition not in EGG_TRANSITIONS:
        raise HTTPException(status_code=400, detail=f"不支持的过渡动效：{payload_transition}")


def _code_taken(db: Session, code: str, exclude_id: int | None = None) -> bool:
    """暗号按归一化后比较，避免"星空"和" 星空 "被当成两个。"""
    want = _normalize(code)
    rows = db.exec(select(EasterEgg)).all()
    for r in rows:
        egg = db_model(r)
        if not isinstance(egg, EasterEgg) or egg.id == exclude_id:
            continue
        if _normalize(egg.code) == want:
            return True
    return False


@admin_router.post("", response_model=EasterEggRead)
def create_egg(
    payload: EasterEggCreate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    _validate(payload.kind, payload.transition)

    code = payload.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="暗号不能为空")
    if _code_taken(db, code):
        raise HTTPException(status_code=409, detail="这个暗号已经存在了")

    now = datetime.now(timezone.utc)
    egg = EasterEgg(
        code=code,
        name=payload.name.strip(),
        hint=(payload.hint or "").strip() or None,
        kind=payload.kind,
        asset_path=(payload.asset_path or "").strip() or None,
        asset_kind=payload.asset_kind,
        transition=payload.transition,
        is_enabled=payload.is_enabled,
        sort_order=payload.sort_order,
        created_at=now,
        updated_at=now,
    )
    db.add(egg)
    db.commit()
    db.refresh(egg)
    logger.info("[彩蛋] 管理员新建：%s（%s）", egg.name, admin.login)

    return EasterEggRead(
        id=int(egg.id or 0),
        code=egg.code,
        name=egg.name,
        hint=egg.hint,
        kind=egg.kind,
        asset_path=egg.asset_path,
        asset_kind=egg.asset_kind,
        transition=egg.transition,
        is_enabled=egg.is_enabled,
        sort_order=egg.sort_order,
        created_at=egg.created_at,
        updated_at=egg.updated_at,
    )


@admin_router.put("/{egg_id}", response_model=EasterEggRead)
def update_egg(
    egg_id: int,
    payload: EasterEggUpdate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    egg = db.get(EasterEgg, egg_id)
    if egg is None:
        raise HTTPException(status_code=404, detail="彩蛋不存在")

    data = payload.model_dump(exclude_unset=True)
    _validate(data.get("kind"), data.get("transition"))

    if "code" in data:
        code = (data["code"] or "").strip()
        if not code:
            raise HTTPException(status_code=400, detail="暗号不能为空")
        if _code_taken(db, code, exclude_id=egg_id):
            raise HTTPException(status_code=409, detail="这个暗号已经存在了")
        data["code"] = code

    for key in ("name", "hint", "asset_path"):
        if key in data:
            value = (data[key] or "").strip()
            data[key] = value or None

    if "name" in data and not data["name"]:
        raise HTTPException(status_code=400, detail="名称不能为空")

    for key, value in data.items():
        setattr(egg, key, value)
    egg.updated_at = datetime.now(timezone.utc)
    db.add(egg)
    db.commit()
    db.refresh(egg)
    logger.info("[彩蛋] 管理员修改：#%s", egg_id)

    return EasterEggRead(
        id=int(egg.id or 0),
        code=egg.code,
        name=egg.name,
        hint=egg.hint,
        kind=egg.kind,
        asset_path=egg.asset_path,
        asset_kind=egg.asset_kind,
        transition=egg.transition,
        is_enabled=egg.is_enabled,
        sort_order=egg.sort_order,
        created_at=egg.created_at,
        updated_at=egg.updated_at,
    )


@admin_router.delete("/{egg_id}")
def delete_egg(
    egg_id: int,
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    egg = db.get(EasterEgg, egg_id)
    if egg is None:
        raise HTTPException(status_code=404, detail="彩蛋不存在")
    db.delete(egg)
    db.commit()
    logger.info("[彩蛋] 管理员删除：#%s", egg_id)
    return {"message": "已删除"}
