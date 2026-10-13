"""
后台管理接口

- GET  /api/admin/stats                   仪表盘看板（卡片 + 趋势 + 分布）
- GET  /api/admin/comments                评论管理列表（筛选 + 分页 + 回复）
- PUT  /api/admin/comments/{id}/status    审核（通过 / 拒绝）
- DELETE /api/admin/comments/{id}         删除评论
- POST /api/admin/track                   前台访问埋点（**公开**）

除 track 外都需要管理员登录。
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session, func, select

from app.database import get_session
from app.deps import get_current_admin
from app.models import (
    Admin,
    Article,
    Comment,
    Commenter,
    Essay,
    LifePost,
    PageView,
)
from app.schemas.admin import (
    AdminComment,
    AdminCommentList,
    AdminReply,
    CommentStatusUpdate,
    DashboardStats,
    DistributionSlice,
    StatCard,
    TrackRequest,
    TrendPoint,
)
from app.services.log_service import log_operation
from app.services.pageview import record_pageview

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["后台管理"])

# 趋势图统计的天数
TREND_DAYS = 30


def _day_keys(days: int) -> list[str]:
    """最近 N 天的日期键（YYYY-MM-DD），从早到晚，含今天"""
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]


def _as_aware(dt: datetime) -> datetime:
    """MySQL 取出来的 DATETIME 是 naive，统一补 UTC"""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


# ============================================================
# 访问埋点（公开）
# ============================================================

@router.post("/track")
def track(payload: TrackRequest, request: Request, db: Session = Depends(get_session)):
    """前台上报一次页面访问。

    这是公开接口（不需要登录），所以：
    - 只接受站内相对路径，避免被写进奇怪的字符串
    - 有去重窗口，前端重复上报不会灌水
    """
    path = payload.path.strip()
    if not path.startswith("/"):
        raise HTTPException(status_code=400, detail="path 必须是站内相对路径")
    # 去掉查询串，避免把参数也记进去
    path = path.split("?", 1)[0][:300]

    # 后台页面不计入前台访问统计
    if path.startswith("/admin"):
        return {"recorded": False, "reason": "admin"}

    recorded = record_pageview(db, request, path)
    return {"recorded": recorded}


# ============================================================
# 仪表盘看板
# ============================================================

@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """仪表盘看板数据：顶部卡片 + 两张趋势图 + 两张分布图。

    趋势图刻意在 Python 里按天分桶，而不是用 SQL 的 DATE() 函数：
    · 数据库里存的是 UTC，按天分桶要考虑时区；
    · 博客量级很小（一个月几千行），拉回来用 Python 分桶更直观也更好调试。
    """
    days = _day_keys(TREND_DAYS)
    start = datetime.now(timezone.utc) - timedelta(days=TREND_DAYS)

    def count(model) -> int:
        return db.exec(select(func.count()).select_from(model)).one()

    # ---- 顶部卡片 ----
    published = db.exec(
        select(func.count())
        .select_from(Article)
        .where(Article.status == "published")
    ).one()
    drafts = db.exec(
        select(func.count())
        .select_from(Article)
        .where(Article.status != "published")
    ).one()

    categories = db.exec(
        select(func.count(func.distinct(Article.category))).where(
            Article.category.is_not(None), Article.category != ""
        )
    ).one()

    # 标签在库里是一行逗号分隔的字符串，只能拆开去重
    tag_rows = db.exec(
        select(Article.tags).where(Article.tags.is_not(None), Article.tags != "")
    ).all()
    tag_set: set[str] = set()
    for raw in tag_rows:
        for t in str(raw).split(","):
            t = t.strip()
            if t:
                tag_set.add(t)

    comment_total = count(Comment)

    # 访客数 = 最近 30 天内去重后的 visitor_hash 个数
    visitor_rows = db.exec(
        select(PageView.visitor_hash).where(PageView.created_at >= start)
    ).all()
    visitor_count = len({v for v in visitor_rows if v})

    cards = [
        StatCard(key="published", label="已发布文章", value=published),
        StatCard(key="drafts", label="草稿", value=drafts),
        StatCard(key="categories", label="分类", value=categories),
        StatCard(key="tags", label="标签", value=len(tag_set)),
        StatCard(key="comments", label="评论", value=comment_total),
        StatCard(key="visitors", label="访客", value=visitor_count),
    ]

    # ---- 文章发布趋势（近 30 天）----
    article_days: dict[str, int] = {d: 0 for d in days}
    for created in db.exec(
        select(Article.created_at).where(Article.created_at >= start)
    ).all():
        key = _as_aware(created).date().isoformat()
        if key in article_days:
            article_days[key] += 1

    # ---- 访客趋势（近 30 天，按天去重）----
    seen: dict[str, set[str]] = {d: set() for d in days}
    for created, vhash in db.exec(
        select(PageView.created_at, PageView.visitor_hash).where(
            PageView.created_at >= start
        )
    ).all():
        key = _as_aware(created).date().isoformat()
        if key in seen and vhash:
            seen[key].add(vhash)

    # ---- 分类分布 ----
    category_rows = db.exec(
        select(Article.category, func.count(Article.id))
        .where(Article.category.is_not(None), Article.category != "")
        .group_by(Article.category)
        .order_by(func.count(Article.id).desc())
    ).all()
    category_distribution = [
        DistributionSlice(name=str(name), value=int(n)) for name, n in category_rows
    ]

    # ---- 浏览器分布（近 30 天按访问次数）----
    browser_rows = db.exec(
        select(PageView.browser, func.count(PageView.id))
        .where(PageView.created_at >= start)
        .group_by(PageView.browser)
        .order_by(func.count(PageView.id).desc())
    ).all()
    browser_distribution = [
        DistributionSlice(name=str(name or "Unknown"), value=int(n))
        for name, n in browser_rows
    ]

    return DashboardStats(
        cards=cards,
        article_trend=[
            TrendPoint(date=d[5:], value=article_days[d]) for d in days
        ],
        visitor_trend=[TrendPoint(date=d[5:], value=len(seen[d])) for d in days],
        category_distribution=category_distribution,
        browser_distribution=browser_distribution,
        range_start=days[0],
        range_end=days[-1],
    )


# ============================================================
# 评论管理
# ============================================================

def _target_type_of(c: Comment) -> str:
    if c.essay_id is not None:
        return "essay"
    if c.life_post_id is not None:
        return "life"
    if c.article_id is not None:
        return "article"
    return "guestbook"


TARGET_LABELS = {
    "essay": "说说",
    "life": "生活动态",
    "article": "文章",
    "guestbook": "杂谈",
}


def _target_titles(db: Session, rows: list[Comment]) -> dict[tuple[str, int], str]:
    """批量取目标标题，避免逐条查询（N+1）。

    留言板没有实体，直接给固定名。
    """
    ids_by_type: dict[str, set[int]] = {"article": set(), "essay": set(), "life": set()}
    for c in rows:
        if c.article_id is not None:
            ids_by_type["article"].add(c.article_id)
        elif c.essay_id is not None:
            ids_by_type["essay"].add(c.essay_id)
        elif c.life_post_id is not None:
            ids_by_type["life"].add(c.life_post_id)

    titles: dict[tuple[str, int], str] = {}

    if ids_by_type["article"]:
        for a in db.exec(
            select(Article).where(Article.id.in_(ids_by_type["article"]))
        ).all():
            titles[("article", a.id)] = a.title or f"文章 #{a.id}"

    if ids_by_type["essay"]:
        for e in db.exec(select(Essay).where(Essay.id.in_(ids_by_type["essay"]))).all():
            # 说说没有标题，用正文前 20 字当标题
            text = (e.title or e.content or "").strip().replace("\n", " ")
            titles[("essay", e.id)] = (text[:20] + "…") if len(text) > 20 else (text or f"说说 #{e.id}")

    if ids_by_type["life"]:
        for lp in db.exec(
            select(LifePost).where(LifePost.id.in_(ids_by_type["life"]))
        ).all():
            text = (lp.content or "").strip().replace("\n", " ")
            titles[("life", lp.id)] = (text[:20] + "…") if len(text) > 20 else (text or f"动态 #{lp.id}")

    return titles


def _to_reply(c: Comment) -> AdminReply:
    return AdminReply(
        id=c.id or 0,
        author_login=c.author_login,
        author_name=c.author_name,
        author_avatar=c.author_avatar,
        author_html_url=f"https://github.com/{c.author_login}" if c.author_login else None,
        content=c.content,
        ip=c.ip,
        status=c.status,
        created_at=c.created_at,
    )


@router.get("/comments", response_model=AdminCommentList)
def list_admin_comments(
    target: str | None = Query(default=None, description="essay/life/article/guestbook"),
    status: str | None = Query(default=None, description="approved/rejected"),
    keyword: str | None = Query(default=None, description="按内容或用户名搜索"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """评论管理列表。

    只看**顶层评论**（回复挂在各自的 replies 里），
    这样表格一行就是一条"会话"，点开可看回复 —— 与后台截图的结构一致。
    """
    conditions = [Comment.parent_id.is_(None)]

    if target == "essay":
        conditions.append(Comment.essay_id.is_not(None))
    elif target == "life":
        conditions.append(Comment.life_post_id.is_not(None))
    elif target == "article":
        conditions.append(Comment.article_id.is_not(None))
    elif target == "guestbook":
        conditions.append(Comment.essay_id.is_(None))
        conditions.append(Comment.life_post_id.is_(None))
        conditions.append(Comment.article_id.is_(None))

    if status in ("approved", "rejected"):
        conditions.append(Comment.status == status)

    if keyword:
        kw = f"%{keyword.strip()}%"
        conditions.append(Comment.content.like(kw) | Comment.author_login.like(kw))

    total = db.exec(
        select(func.count()).select_from(Comment).where(*conditions)
    ).one()

    rows = db.exec(
        select(Comment)
        .where(*conditions)
        .order_by(Comment.created_at.desc(), Comment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    # 一次把这些顶层评论的回复全查出来，避免每条一次查询
    parent_ids = [c.id for c in rows if c.id]
    replies_map: dict[int, list[Comment]] = {}
    if parent_ids:
        for r in db.exec(
            select(Comment)
            .where(Comment.parent_id.in_(parent_ids))
            .order_by(Comment.created_at.asc(), Comment.id.asc())
        ).all():
            replies_map.setdefault(r.parent_id or 0, []).append(r)

    titles = _target_titles(db, rows)

    comments: list[AdminComment] = []
    for c in rows:
        ttype = _target_type_of(c)
        tid = c.article_id or c.essay_id or c.life_post_id
        if ttype == "guestbook":
            title = "留言板"
        else:
            title = titles.get((ttype, tid), f"{TARGET_LABELS.get(ttype, ttype)} #{tid}")
        comments.append(
            AdminComment(
                id=c.id or 0,
                target_type=ttype,
                target_id=tid,
                target_title=title,
                author_login=c.author_login,
                author_name=c.author_name,
                author_avatar=c.author_avatar,
                author_html_url=(
                    f"https://github.com/{c.author_login}" if c.author_login else None
                ),
                content=c.content,
                ip=c.ip,
                reply_count=len(replies_map.get(c.id or 0, [])),
                status=c.status,
                created_at=c.created_at,
                replies=[_to_reply(r) for r in replies_map.get(c.id or 0, [])],
            )
        )

    return AdminCommentList(
        total=total, page=page, page_size=page_size, comments=comments
    )


@router.put("/comments/{comment_id}/status")
def update_comment_status(
    comment_id: int,
    payload: CommentStatusUpdate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """审核评论：通过 / 拒绝。

    只改这条评论自己的状态（回复是否显示由前台各自决定）。
    """
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="评论不存在")

    old = comment.status
    if old == payload.status:
        return {"message": "状态未变化", "status": old}

    comment.status = payload.status
    db.add(comment)
    db.commit()
    db.refresh(comment)

    # log_operation 只 add 不 commit，所以这里补一次提交
    log_operation(
        db,
        admin_id=admin.id or 0,
        action="update",
        target_type="comment",
        target_id=comment_id,
        changes={"status": {"old": old, "new": payload.status}},
    )
    db.commit()
    return {"message": "已更新", "status": comment.status}


@router.delete("/comments/{comment_id}")
def delete_admin_comment(
    comment_id: int,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """后台删除评论（连带删掉它的回复与点赞）。

    删除顺序参考前台 delete_comment：
    comments.parent_id 自引用 + comment_likes 引用 comments，
    且 SQLAlchemy 默认 autoflush 会把待删的父评论提前 flush 成 DELETE，
    所以要用 no_autoflush 先查清楚，再按 点赞 → 回复 → 父评论 删。
    """
    from app.models import CommentLike

    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="评论不存在")

    with db.no_autoflush:
        replies = db.exec(
            select(Comment).where(Comment.parent_id == comment_id)
        ).all()
        ids = [comment_id] + [r.id for r in replies if r.id]
        likes = db.exec(
            select(CommentLike).where(CommentLike.comment_id.in_(ids))
        ).all()

    for like in likes:
        db.delete(like)
    db.commit()
    for r in replies:
        db.delete(r)
    db.commit()
    db.delete(comment)
    db.commit()

    # log_operation 只 add 不 commit，所以这里补一次提交
    log_operation(
        db,
        admin_id=admin.id or 0,
        action="delete",
        target_type="comment",
        target_id=comment_id,
        changes={
            "author": {"old": comment.author_login, "new": None},
            "replies_removed": {"old": len(replies), "new": 0},
        },
    )
    db.commit()
    return {"message": "已删除"}
