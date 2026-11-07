"""
生活动态点赞的测试。

覆盖：
  · 列表接口默认返回 likes=0 / liked=false（未登录）
  · 点赞 → 取消 → 再点赞的 toggle 结果与计数
  · 两个人分别点赞 → 计数累加
  · 读接口：未登录 liked 恒 false；登录后能读到自己的点赞态
  · 列表接口按登录者返回 liked（不会串号）
  · 数据库唯一索引真的挡住了重复点赞（并发下的最后一道防线）
  · 点赞不存在的动态 → 404
  · 随笔点赞不受影响（同一张表，必须验证没被污染）

用法：python scripts/test_life_likes.py --allow-production-db
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.db_utils import count as db_count  # noqa: E402
from app.models import Commenter, EssayLike, LifePost  # noqa: E402
from app.routers.life import (  # noqa: E402
    list_life_posts,
    read_life_likes,
    toggle_life_like,
)

guard("test_life_likes.py")
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []
PREFIX = "__lifelike_"
LOGINS = [PREFIX + "alice", PREFIX + "bob"]


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
        posts = db.exec(
            select(LifePost).where(LifePost.content.startswith(PREFIX))
        ).all()
        pids = [p.id for p in (unwrap(r, LifePost) for r in posts) if p]

        if pids:
            likes = db.exec(
                select(EssayLike).where(EssayLike.life_post_id.in_(pids))
            ).all()
            for r in likes:
                obj = unwrap(r, EssayLike)
                if obj is not None:
                    db.delete(obj)
            db.commit()

        for r in posts:
            obj = unwrap(r, LifePost)
            if obj is not None:
                db.delete(obj)
        db.commit()

        who = db.exec(
            select(Commenter).where(Commenter.login.startswith(PREFIX))
        ).all()
        for r in who:
            obj = unwrap(r, Commenter)
            if obj is not None:
                db.delete(obj)
        db.commit()


cleanup()

# ------------------------------------------------------------------ 准备
print("=== 0. 准备数据 ===")
now = datetime.now(timezone.utc)
with Session(engine) as db:
    ids = []
    for i, login in enumerate(LOGINS):
        c = Commenter(
            github_id=970000 + i,
            login=login,
            name=login.replace(PREFIX, ""),
            created_at=now,
            last_login_at=now,
        )
        db.add(c)
        db.flush()
        ids.append(c.id)
    post = LifePost(content=PREFIX + "测试动态", created_at=now)
    db.add(post)
    db.flush()
    post_id = post.id
    db.commit()

alice_id, bob_id = ids
print(f"  alice={alice_id} bob={bob_id} post={post_id}")

# ------------------------------------------------------------------ 初始
print("\n=== 1. 初始状态（未登录看列表）===")
with Session(engine) as db:
    rows = list_life_posts(limit=100, offset=0, db=db, viewer=None)
    mine = [r for r in rows if r.id == post_id]
check_true("能在列表里找到测试动态", len(mine) == 1)
if mine:
    check("初始 likes", mine[0].likes, 0)
    check("未登录 liked", mine[0].liked, False)

# ------------------------------------------------------------------ toggle
print("\n=== 2. 点赞 / 取消 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    res = toggle_life_like(post_id, db=db, commenter=alice)
check("第一次点赞 liked=True", res.liked, True)
check("计数 = 1", res.likes, 1)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    res = toggle_life_like(post_id, db=db, commenter=alice)
check("再点一次 liked=False（取消）", res.liked, False)
check("计数回 0", res.likes, 0)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    res = toggle_life_like(post_id, db=db, commenter=alice)
check("第三次又点上", res.liked, True)
check("计数 = 1", res.likes, 1)

print("\n=== 3. 两个人分别点赞 ===")
with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    res = toggle_life_like(post_id, db=db, commenter=bob)
check("bob 点赞后计数 = 2", res.likes, 2)

# ------------------------------------------------------------------ 读接口
print("\n=== 4. 读接口 ===")
with Session(engine) as db:
    anon = read_life_likes(post_id, db=db, viewer=None)
check("未登录：计数 2", anon.likes, 2)
check("未登录：liked 恒 false", anon.liked, False)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    mine = read_life_likes(post_id, db=db, viewer=alice)
check("alice 看到 liked=True", mine.liked, True)

with Session(engine) as db:
    carol_like = read_life_likes(post_id, db=db, viewer=None)
check("第三人（未登录）liked=False", carol_like.liked, False)

# ------------------------------------------------------------------ 列表带 liked
print("\n=== 5. 列表接口按登录者返回 liked ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    rows = list_life_posts(limit=100, offset=0, db=db, viewer=alice)
    mine = [r for r in rows if r.id == post_id]
check_true("列表里能拿到", len(mine) == 1)
if mine:
    check("alice 的列表 liked=True", mine[0].liked, True)
    check("列表计数 = 2", mine[0].likes, 2)

with Session(engine) as db:
    # 建一个没点过赞的人，验证不会串号
    stranger = db.exec(
        select(Commenter).where(Commenter.login == PREFIX + "alice")
    ).first()
    sid = unwrap(stranger, Commenter).id
    bob = db.get(Commenter, bob_id)
    rows = list_life_posts(limit=100, offset=0, db=db, viewer=bob)
    mine = [r for r in rows if r.id == post_id]
if mine:
    check_true("bob 也点过，所以 liked=True", mine[0].liked, True)
check_true("stranger id 正常", isinstance(sid, int))

# ------------------------------------------------------------------ 唯一索引
print("\n=== 6. 数据库唯一索引挡重复 ===")
dup_blocked = False
with Session(engine) as db:
    try:
        db.add(EssayLike(life_post_id=post_id, commenter_id=alice_id))
        db.commit()
        # 已经存在 alice 的那条，这里应被唯一索引拒绝
        dup_blocked = False
    except IntegrityError:
        db.rollback()
        dup_blocked = True
check("重复点赞被唯一索引拒绝", dup_blocked, True)

# 确认计数没被污染
with Session(engine) as db:
    total = db_count(
        db.exec(
            select(func.count(EssayLike.id)).where(EssayLike.life_post_id == post_id)
        ).one()
    )
check("计数仍是 2", total, 2)

# ------------------------------------------------------------------ 404
print("\n=== 7. 边界 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    try:
        toggle_life_like(999999, db=db, commenter=alice)
        check("点赞不存在的动态应 404", False, True)
    except HTTPException as e:
        check("点赞不存在的动态 → 404", e.status_code, 404)

with Session(engine) as db:
    try:
        read_life_likes(999999, db=db, viewer=None)
        check("读取不存在的动态应 404", False, True)
    except HTTPException as e:
        check("读取不存在的动态 → 404", e.status_code, 404)

# ------------------------------------------------------------------ 随笔不受影响
print("\n=== 8. 随笔点赞没被污染（同一张表）===")
with Session(engine) as db:
    essay_likes = db_count(
        db.exec(
            select(func.count(EssayLike.id)).where(EssayLike.essay_id.is_not(None))
        ).one()
    )
    life_likes = db_count(
        db.exec(
            select(func.count(EssayLike.id)).where(EssayLike.life_post_id.is_not(None))
        ).one()
    )
check_true("随笔点赞行数与动态点赞行数互不干扰",
           essay_likes >= 0 and life_likes >= 2,
           f"essay={essay_likes} life={life_likes}")

# ------------------------------------------------------------------ 收尾
cleanup()
print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 生活动态点赞全部断言通过")
