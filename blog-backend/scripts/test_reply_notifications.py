"""
站内回复通知的测试。

覆盖：
  · 顶层评论不产生通知
  · 被回复 → 对方收到 1 条通知，未读数 +1
  · 自己回复自己不通知
  · 回复"回复"时，通知给的是**顶层父评论作者**（扁平结构的固有行为）
  · 同一条回复不会重复产生通知（幂等）
  · 标记已读：全部 / 指定 ids
  · 不同目标的 link 生成（随笔 / 文章用 slug / 留言板）
  · 未登录调用一律 401
  · 列表只返回自己的通知（不会串号）

用法：python scripts/test_reply_notifications.py --allow-production-db
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.models import (  # noqa: E402
    Article,
    Commenter,
    Essay,
    ReplyNotification,
)
from app.routers.comments import (  # noqa: E402
    _notify_reply,
    create_article_comment,
    create_essay_comment,
    create_guestbook_message,
    require_commenter,
)
from app.routers.reply_notifications import (  # noqa: E402
    get_unread_count,
    list_notifications,
    mark_read,
)
from app.schemas.comment import CommentCreate  # noqa: E402
from app.schemas.reply_notification import MarkReadRequest  # noqa: E402

guard("test_reply_notifications.py")
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []

PREFIX = "__rnotify_"
LOGINS = [PREFIX + "alice", PREFIX + "bob", PREFIX + "carol"]


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(f"{label}: got={got!r} want={want!r}")
        print(f"          got ={got!r}")
        print(f"          want={want!r}")


def check_true(label, cond, extra=""):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(f"{label} {extra}")
        if extra:
            print(f"          {extra}")


def unwrap(row, model):
    if row is None:
        return None
    if isinstance(row, model):
        return row
    try:
        first = row[0]
        return first if isinstance(first, model) else None
    except (TypeError, IndexError, KeyError):
        return None


def cleanup() -> None:
    with Session(engine) as db:
        # 删通知（按 actor_login 前缀）
        rows = db.exec(
            select(ReplyNotification).where(
                ReplyNotification.actor_login.startswith(PREFIX)
            )
        ).all()
        for r in rows:
            obj = unwrap(r, ReplyNotification)
            if obj is not None:
                db.delete(obj)
        db.commit()

        # 删评论（按 author_login 前缀）。
        # comments.parent_id 是自引用外键，必须先删"回复"再删"顶层"，
        # 否则 DELETE 父行会被外键顶回来（IntegrityError 1451）。
        from app.models import Comment

        for where_parent in (True, False):
            stmt = select(Comment).where(Comment.author_login.startswith(PREFIX))
            stmt = (
                stmt.where(Comment.parent_id.is_not(None))
                if where_parent
                else stmt.where(Comment.parent_id.is_(None))
            )
            crows = db.exec(stmt).all()
            for r in crows:
                obj = unwrap(r, Comment)
                if obj is not None:
                    db.delete(obj)
            db.commit()

        # 删测试随笔/文章
        erows = db.exec(
            select(Essay).where(Essay.title.startswith(PREFIX))
        ).all()
        for r in erows:
            obj = unwrap(r, Essay)
            if obj is not None:
                db.delete(obj)
        arows = db.exec(
            select(Article).where(Article.title.startswith(PREFIX))
        ).all()
        for r in arows:
            obj = unwrap(r, Article)
            if obj is not None:
                db.delete(obj)
        db.commit()

        # 删测试 commenter
        crows2 = db.exec(
            select(Commenter).where(Commenter.login.startswith(PREFIX))
        ).all()
        for r in crows2:
            obj = unwrap(r, Commenter)
            if obj is not None:
                db.delete(obj)
        db.commit()


cleanup()

# ------------------------------------------------------------------ setup
print("=== 0. 准备测试数据 ===")
now = datetime.now(timezone.utc)
with Session(engine) as db:
    ids = []
    for i, login in enumerate(LOGINS):
        c = Commenter(
            github_id=990000 + i,
            login=login,
            name=login.replace(PREFIX, ""),
            avatar_url=None,
            html_url=f"https://github.com/{login}",
            created_at=now,
            last_login_at=now,
        )
        db.add(c)
        db.flush()
        ids.append(c.id)
    essay = Essay(title=PREFIX + "测试随笔", content="正文", created_at=now, updated_at=now)
    db.add(essay)
    db.flush()
    essay_id = essay.id
    article = Article(
        title=PREFIX + "测试文章",
        slug=PREFIX + "test-article",
        content="正文",
        status="published",
        created_at=now,
        updated_at=now,
    )
    db.add(article)
    db.flush()
    article_id = article.id
    db.commit()

alice_id, bob_id, carol_id = ids
print(f"  alice={alice_id} bob={bob_id} carol={carol_id} essay={essay_id} article={article_id}")

# ------------------------------------------------------------------ 顶层评论
print("\n=== 1. 顶层评论不产生通知 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    c1 = create_essay_comment(
        essay_id, CommentCreate(content="alice 的顶层评论"), db=db, ip=None, commenter=alice
    )
with Session(engine) as db:
    rows = db.exec(
        select(ReplyNotification).where(
            ReplyNotification.actor_login.startswith(PREFIX)
        )
    ).all()
check("没有通知", len(rows), 0)

# ------------------------------------------------------------------ 回复
print("\n=== 2. bob 回复 alice ===")
with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    r1 = create_essay_comment(
        essay_id,
        CommentCreate(content="bob 回复了 alice", parent_id=c1.id),
        db=db,
        ip=None,
        commenter=bob,
    )

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    listing = list_notifications(db=db, me=alice)
check("alice 有 1 条通知", len(listing.items), 1)
check("未读数是 1", listing.unread_count, 1)
n1 = listing.items[0]
check("收件人正确（bob 回复了 alice 的评论）", n1.comment_id, r1.id)
check("parent_comment_id 指向顶层", n1.parent_comment_id, c1.id)
check("记录了回复者 login", n1.actor_login, LOGINS[1])
check_true("预览里有内容", "bob 回复了 alice" in n1.preview, n1.preview[:40])
check("默认未读", n1.is_read, False)
check("随笔的链接", n1.link, "/essays")
check("target_type", n1.target_type, "essay")

# bob 自己没有任何通知
with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    bl = list_notifications(db=db, me=bob)
check("bob 没有通知（他不是被回复者）", len(bl.items), 0)

# ------------------------------------------------------------------ 自己回复自己
print("\n=== 3. 自己回复自己不通知 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    create_essay_comment(
        essay_id,
        CommentCreate(content="alice 回复自己", parent_id=c1.id),
        db=db,
        ip=None,
        commenter=alice,
    )
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    listing = list_notifications(db=db, me=alice)
check("通知数仍是 1", len(listing.items), 1)

# ------------------------------------------------------------------ 回复的回复
print("\n=== 4. carol 回复 bob 的回复 → 通知给顶层作者 alice ===")
with Session(engine) as db:
    carol = db.get(Commenter, carol_id)
    r2 = create_essay_comment(
        essay_id,
        CommentCreate(content="carol 回复 bob", parent_id=r1.id),
        db=db,
        ip=None,
        commenter=carol,
    )
check("被提升到顶层父评论", r2.parent_id, c1.id)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    listing = list_notifications(db=db, me=alice)
check("alice 现在有 2 条", len(listing.items), 2)
check("未读 2", listing.unread_count, 2)

with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    bl = list_notifications(db=db, me=bob)
check("bob 仍然没有通知（扁平结构的已知行为）", len(bl.items), 0)

# ------------------------------------------------------------------ 幂等
print("\n=== 5. 幂等：同一条回复不重复通知 ===")
with Session(engine) as db:
    row = db.exec(
        select(ReplyNotification).where(ReplyNotification.comment_id == r1.id)
    ).first()
    before = len(
        db.exec(
            select(ReplyNotification).where(
                ReplyNotification.actor_login.startswith(PREFIX)
            )
        ).all()
    )
with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    from app.models import Comment

    r1_row = db.get(Comment, r1.id)
    _notify_reply(db, r1_row, c1.id)   # 再调一次
with Session(engine) as db:
    after = len(
        db.exec(
            select(ReplyNotification).where(
                ReplyNotification.actor_login.startswith(PREFIX)
            )
        ).all()
    )
check("重复调用没有新增", after, before)

# ------------------------------------------------------------------ 文章 / 留言板链接
print("\n=== 6. 不同目标的链接 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    a_top = create_article_comment(
        article_id, CommentCreate(content="文章下的评论"), db=db, ip=None, commenter=alice
    )
with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    create_article_comment(
        article_id,
        CommentCreate(content="回复文章评论", parent_id=a_top.id),
        db=db,
        ip=None,
        commenter=bob,
    )
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    listing = list_notifications(db=db, me=alice)
    art = [i for i in listing.items if i.target_type == "article"]
check_true("文章通知存在", len(art) >= 1)
if art:
    check("文章链接用 slug", art[0].link, f"/articles/{PREFIX}test-article")

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    g_top = create_guestbook_message(
        CommentCreate(content="留言板留言"), db=db, ip=None, commenter=alice
    )
with Session(engine) as db:
    carol = db.get(Commenter, carol_id)
    create_guestbook_message(
        CommentCreate(content="回复留言", parent_id=g_top.id), db=db, ip=None, commenter=carol
    )
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    listing = list_notifications(db=db, me=alice)
    gb = [i for i in listing.items if i.target_type == "guestbook"]
check_true("留言板通知存在", len(gb) >= 1)
if gb:
    check("留言板链接", gb[0].link, "/guestbook")

# ------------------------------------------------------------------ 未读数 / 已读
print("\n=== 7. 未读数与标记已读 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    cnt = get_unread_count(db=db, me=alice)
check_true("未读数 > 0", cnt.count > 0, str(cnt.count))

# 只标一条
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    one = list_notifications(db=db, me=alice).items[0]
    res = mark_read(MarkReadRequest(ids=[one.id]), db=db, me=alice)
check("标记 1 条后未读 -1", res.count, cnt.count - 1)

# 全部标为已读
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    res = mark_read(MarkReadRequest(ids=None), db=db, me=alice)
check("全部已读后未读为 0", res.count, 0)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    listing = list_notifications(db=db, me=alice)
check_true("列表里的都已读", all(i.is_read for i in listing.items))

# 重复标记不报错
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    res = mark_read(MarkReadRequest(ids=None), db=db, me=alice)
check("重复标记仍是 0", res.count, 0)

# ------------------------------------------------------------------ 鉴权
print("\n=== 8. 未登录一律 401 ===")
for label, fn in (
    ("require_commenter(None)", lambda: require_commenter(None)),
):
    try:
        fn()
        check(f"{label} 应抛 401", False, True)
    except HTTPException as e:
        check(f"{label} → {e.status_code}", e.status_code, 401)

# ------------------------------------------------------------------ 收尾
cleanup()
print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 站内回复通知全部断言通过")
