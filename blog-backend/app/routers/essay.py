"""
随笔（说说）路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, func, select

from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, Essay
from app.schemas.essay import EssayCreate, EssayRead, EssayUpdate
from app.services.log_service import (
    apply_updates,
    dumps_json_list,
    loads_json_list,
    log_operation,
)

router = APIRouter(prefix="/api/essays", tags=["随笔"])


def _to_read(e: Essay) -> EssayRead:
    """数据库记录 → 响应对象（解析 images JSON）

    images 在库里存的是 JSON 字符串，响应里要还原成数组。
    life.py 里有同样的需求，解析/序列化逻辑都放在 log_service 里共用。
    """
    return EssayRead(
        id=e.id or 0,
        title=e.title,
        content=e.content,
        excerpt=e.excerpt,
        images=loads_json_list(e.images),
        likes=e.likes,
        created_at=e.created_at,
        updated_at=e.updated_at,
    )


@router.get("", response_model=list[EssayRead])
def list_essays(
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_session),
):
    stmt = (
        select(Essay)
        .order_by(Essay.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [_to_read(e) for e in db.exec(stmt).all()]


@router.get("/random", response_model=EssayRead | None)
def random_essay(db: Session = Depends(get_session)):
    stmt = select(Essay).order_by(func.rand()).limit(1)
    e = db.exec(stmt).first()
    return _to_read(e) if e else None


@router.get("/{essay_id}", response_model=EssayRead)
def get_essay(essay_id: int, db: Session = Depends(get_session)):
    e = db.get(Essay, essay_id)
    if not e:
        raise HTTPException(status_code=404, detail="随笔不存在")
    return _to_read(e)


@router.post("/{essay_id}/like")
def like_essay(essay_id: int, db: Session = Depends(get_session)):
    """点赞 +1（无需登录）"""
    e = db.get(Essay, essay_id)
    if not e:
        raise HTTPException(status_code=404, detail="随笔不存在")
    e.likes += 1
    db.add(e)
    db.commit()
    return {"likes": e.likes}


@router.post("", response_model=EssayRead)
def create_essay(
    data: EssayCreate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    e = Essay(
        title=data.title,
        content=data.content,
        excerpt=data.excerpt,
        images=dumps_json_list(data.images),
    )
    db.add(e)
    db.flush()
    log_operation(db, current_admin.id, "create", "essay", e.id, None)
    db.commit()
    db.refresh(e)
    return _to_read(e)


@router.put("/{essay_id}", response_model=EssayRead)
def update_essay(
    essay_id: int,
    data: EssayUpdate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    e = db.get(Essay, essay_id)
    if not e:
        raise HTTPException(status_code=404, detail="随笔不存在")

    update = data.model_dump(exclude_unset=True)
    # images 是数组，落库前先序列化成 JSON 字符串
    if "images" in update and update["images"] is not None:
        update["images"] = dumps_json_list(update["images"])

    apply_updates(db, e, update, current_admin.id, "essay", essay_id)

    db.commit()
    db.refresh(e)
    return _to_read(e)


@router.delete("/{essay_id}")
def delete_essay(
    essay_id: int,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    e = db.get(Essay, essay_id)
    if not e:
        raise HTTPException(status_code=404, detail="随笔不存在")
    log_operation(db, current_admin.id, "delete", "essay", essay_id, None)
    db.delete(e)
    db.commit()
    return {"message": "已删除"}
