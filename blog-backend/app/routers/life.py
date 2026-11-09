"""
生活动态路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, func, select

from app.services.review import is_publicly_visible, public_conditions, stamp_new_content
from app.database import get_session
from app.db_utils import count as db_count
from app.deps import (
    get_current_admin,
    get_current_admin_optional,
    require_content_owner,
)
from app.models import Admin, Commenter, EssayLike, LifePost
# 点赞的登录态与"随笔点赞"共用同一套（定义在 comments.py）
from app.routers.comments import get_current_commenter, require_commenter
from app.schemas.comment import LikeResponse
from app.schemas.life import LifePostCreate, LifePostRead, LifePostUpdate
from app.services.log_service import (
    apply_updates,
    dumps_json_list,
    loads_json_list,
    log_operation,
)
from app.services import notifier

router = APIRouter(prefix="/api/life", tags=["生活"])

def _to_read(p: LifePost, likes: int = 0, liked: bool = False) -> LifePostRead:
    """把数据库记录转成响应对象，解析 images JSON"""
    return LifePostRead(
        id=p.id or 0,
        content=p.content,
        images=loads_json_list(p.images),
        location=p.location,
        created_at=p.created_at,
        likes=likes,
        liked=liked,
        review_status=p.review_status,
        status=p.status,
    )

def _like_counts(db: Session, post_ids: list[int]) -> dict[int, int]:
    """一次查出多条动态的点赞数，避免每条一次 count（N+1）。"""
    if not post_ids:
        return {}
    rows = db.exec(
        select(EssayLike.life_post_id, func.count(EssayLike.id))
        .where(EssayLike.life_post_id.in_(post_ids))
        .group_by(EssayLike.life_post_id)
    ).all()
    out: dict[int, int] = {}
    for r in rows:
        try:
            pid, n = r[0], r[1]
        except (TypeError, KeyError, IndexError):
            continue
        if pid is not None:
            out[int(pid)] = int(n or 0)
    return out

def _liked_ids(db: Session, post_ids: list[int], viewer: Commenter | None) -> set[int]:
    """当前登录者赞过哪些（未登录返回空集）。"""
    if not viewer or not post_ids:
        return set()
    rows = db.exec(
        select(EssayLike.life_post_id).where(
            EssayLike.life_post_id.in_(post_ids),
            EssayLike.commenter_id == viewer.id,
        )
    ).all()
    out: set[int] = set()
    for r in rows:
        try:
            val = r[0]
        except (TypeError, KeyError, IndexError):
            val = r
        if val is not None:
            out.add(int(val))
    return out

@router.get("", response_model=list[LifePostRead])
def list_life_posts(
    limit: int = 100,
    offset: int = 0,
    mine: bool = False,
    db: Session = Depends(get_session),
    viewer: Commenter | None = Depends(get_current_commenter),
    # visitor=True 表示这是前台请求，必须按访客视角过滤（即使浏览器带着管理员 Cookie）
    visitor: bool = False,
    staff: Admin | None = Depends(get_current_admin_optional),
):
    """动态列表，按时间倒序。带上点赞数与"我是否赞过"。

    点赞数用一条 GROUP BY 查出来（不是每条一次 count），
    liked 也是一条 in 查询 —— 列表页只有一两次额外查询。
    """
    stmt = select(LifePost)
    # 访客只看已发布且过审的
    if visitor or staff is None:
        stmt = stmt.where(*public_conditions(LifePost))
    if mine:
        # 注意：这里的 viewer 是**评论者**（点赞用），后台过滤要用 staff
        if visitor or staff is None:
            raise HTTPException(status_code=401, detail="未登录")
        stmt = stmt.where(LifePost.author_id == staff.id)
    stmt = stmt.order_by(LifePost.created_at.desc()).offset(offset).limit(limit)
    posts = [r if isinstance(r, LifePost) else r[0] for r in db.exec(stmt).all()]
    posts = [p for p in posts if isinstance(p, LifePost)]

    ids = [int(p.id) for p in posts if p.id is not None]
    counts = _like_counts(db, ids)
    liked = _liked_ids(db, ids, viewer)

    return [
        _to_read(p, counts.get(int(p.id or 0), 0), int(p.id or 0) in liked)
        for p in posts
    ]

@router.get("/{post_id}", response_model=LifePostRead)
def get_life_post(post_id: int, db: Session = Depends(get_session)):
    p = db.get(LifePost, post_id)
    if not p:
        raise HTTPException(status_code=404, detail="动态不存在")

    if not is_publicly_visible(p):
        raise HTTPException(status_code=404, detail="动态不存在")

    return _to_read(p)

@router.post("", response_model=LifePostRead)
def create_life_post(
    data: LifePostCreate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    p = LifePost(
        author_id=current_admin.id,
        content=data.content,
        images=dumps_json_list(data.images),
        location=data.location,
    )
    stamp_new_content(p, current_admin, db)
    db.add(p)
    db.flush()
    log_operation(db, current_admin.id, "create", "life", p.id, None)
    db.commit()
    db.refresh(p)
    result = _to_read(p)
    # 注意：这里原来是 `return` 之后又调 notifier —— 那段代码永远执行不到。
    # 现在把它放到 return 之前，且只在内容真的公开时才推送（待审的不推）。
    if p.status == "published":
        notifier.enqueue_life_created(p)
    return result

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

    # 成员只能改自己的；管理员不受限（author_id 为空的历史数据仅管理员可动）
    require_content_owner(current_admin, p.author_id)

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

    # 成员只能改自己的；管理员不受限（author_id 为空的历史数据仅管理员可动）
    require_content_owner(current_admin, p.author_id)

    log_operation(db, current_admin.id, "delete", "life", post_id, None)
    db.delete(p)
    db.commit()
    return {"message": "已删除"}

# ============================================================
# 点赞
# ============================================================

@router.post("/{post_id}/like", response_model=LikeResponse)
def toggle_life_like(
    post_id: int,
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """给动态点赞 / 取消（需登录，一人一次）。

    与随笔点赞共表（essay_likes 有 life_post_id 列，是通用目标点赞表）。
    点赞数**实时统计行数**，不在 life_posts 上加冗余字段 ——
    冗余字段一旦和明细不同步，就会出现"显示 5 个赞、实际 3 条记录"。
    """
    post = db.get(LifePost, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="动态不存在")

    existing = db.exec(
        select(EssayLike).where(
            EssayLike.life_post_id == post_id,
            EssayLike.commenter_id == commenter.id,
        )
    ).first()

    if existing:
        obj = existing if isinstance(existing, EssayLike) else existing[0]
        db.delete(obj)
        liked = False
    else:
        db.add(EssayLike(life_post_id=post_id, commenter_id=commenter.id))
        liked = True
    db.commit()

    total = db_count(
        db.exec(
            select(func.count(EssayLike.id)).where(EssayLike.life_post_id == post_id)
        ).one()
    )

    return LikeResponse(likes=total, liked=liked)

@router.get("/{post_id}/like", response_model=LikeResponse)
def read_life_likes(
    post_id: int,
    db: Session = Depends(get_session),
    viewer: Commenter | None = Depends(get_current_commenter),
):
    """动态的点赞数与"我是否赞过"（未登录时 liked 恒为 false）"""
    post = db.get(LifePost, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="动态不存在")

    total = db_count(
        db.exec(
            select(func.count(EssayLike.id)).where(EssayLike.life_post_id == post_id)
        ).one()
    )

    liked = False
    if viewer:
        liked = (
            db.exec(
                select(EssayLike).where(
                    EssayLike.life_post_id == post_id,
                    EssayLike.commenter_id == viewer.id,
                )
            ).first()
            is not None
        )

    return LikeResponse(likes=total, liked=liked)
