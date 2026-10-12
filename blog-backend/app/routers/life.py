"""
生活动态路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, LifePost
from app.schemas.life import LifePostCreate, LifePostRead, LifePostUpdate
from app.services.log_service import (
    apply_updates,
    dumps_json_list,
    loads_json_list,
    log_operation,
)

router = APIRouter(prefix="/api/life", tags=["生活"])


def _to_read(p: LifePost) -> LifePostRead:
    """把数据库记录转成响应对象，解析 images JSON"""
    return LifePostRead(
        id=p.id or 0,
        content=p.content,
        images=loads_json_list(p.images),
        location=p.location,
        created_at=p.created_at,
    )


@router.get("", response_model=list[LifePostRead])
def list_life_posts(
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_session),
):
    """动态列表，按时间倒序"""
    stmt = (
        select(LifePost)
        .order_by(LifePost.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [_to_read(p) for p in db.exec(stmt).all()]


@router.get("/{post_id}", response_model=LifePostRead)
def get_life_post(post_id: int, db: Session = Depends(get_session)):
    p = db.get(LifePost, post_id)
    if not p:
        raise HTTPException(status_code=404, detail="动态不存在")
    return _to_read(p)


@router.post("", response_model=LifePostRead)
def create_life_post(
    data: LifePostCreate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    p = LifePost(
        content=data.content,
        images=dumps_json_list(data.images),
        location=data.location,
    )
    db.add(p)
    db.flush()
    log_operation(db, current_admin.id, "create", "life", p.id, None)
    db.commit()
    db.refresh(p)
    return _to_read(p)


@router.put("/{post_id}", response_model=LifePostRead)
def update_life_post(
    post_id: int,
    data: LifePostUpdate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    p = db.get(LifePost, post_id)
    if not p:
        raise HTTPException(status_code=404, detail="动态不存在")

    update = data.model_dump(exclude_unset=True)
    # images 是数组，落库前先序列化成 JSON 字符串
    if "images" in update and update["images"] is not None:
        update["images"] = dumps_json_list(update["images"])

    apply_updates(db, p, update, current_admin.id, "life", post_id)

    db.commit()
    db.refresh(p)
    return _to_read(p)


@router.delete("/{post_id}")
def delete_life_post(
    post_id: int,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    p = db.get(LifePost, post_id)
    if not p:
        raise HTTPException(status_code=404, detail="动态不存在")
    log_operation(db, current_admin.id, "delete", "life", post_id, None)
    db.delete(p)
    db.commit()
    return {"message": "已删除"}
