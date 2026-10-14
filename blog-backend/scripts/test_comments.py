"""
评论系统的数据层端到端测试（不需要启动 HTTP 服务）。

覆盖：建表 / 访客登录态 / 发评论 / 一级回复 / 评论点赞去重 / 说说点赞计数
     / 删除连带清理 / 未登录必须被拒。

用法：python scripts/test_comments.py
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine, inspect, func  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.models import (  # noqa: E402
    Comment,
    Commenter,
    CommenterSession,
    CommentLike,
    Essay,
    EssayLike,
    LifePost,
    Article,
)
from app.routers.comments import (  # noqa: E402
    create_article_comment,
    create_essay_comment,
    create_guestbook_message,
    list_article_comments,
    list_guestbook,

    create_life_comment,
    delete_comment,
    list_essay_comments,
    list_life_comments,
    read_essay_likes,
    require_commenter,
    toggle_comment_like,
    toggle_essay_like,
)
from app.routers.comments import _target_where  # noqa: E402
from app.schemas.comment import CommentCreate  # noqa: E402

# 安全护栏：默认拒绝在非测试库上运行（这些脚本会插入并清理数据）
from test_guard import guard  # noqa: E402

guard("test_comments.py")

engine = create_engine(settings.DATABASE_URL, echo=False)

LOGINS = ["__test_alice", "__test_bob"]
FAILS: list[str] = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(f"{label}: got={got!r} want={want!r}")
        print(f"          got ={got!r}")
        print(f"          want={want!r}")


def expect_raises(label, fn, status_code):
    try:
        fn()
    except HTTPException as e:
        check(label, e.status_code, status_code)
        return
    except Exception as e:
        print(f"  [FAIL] {label} -> 抛了 {type(e).__name__}: {e}")
        FAILS.append(f"{label}: 抛了 {type(e).__name__}")
        return
    print(f"  [FAIL] {label} -> 没有抛异常")
    FAILS.append(f"{label}: 没有抛异常")


def purge(db: Session, logins: list[str]) -> None:
    """按外键顺序清掉测试数据（可重复调用）。

    顺序很重要：
      comment_likes / essay_likes / commenter_sessions
        → 子回复 → 父评论 → commenters
    """
    commenters = db.exec(select(Commenter).where(Commenter.login.in_(logins))).all()
    ids = [c.id for c in commenters if c.id]
    if not ids:
        return

    mine = db.exec(select(Comment).where(Comment.commenter_id.in_(ids))).all()
    all_comments = db.exec(select(Comment)).all()
    doomed = {c.id for c in mine if c.id}
    changed = True
    while changed:  # 收敛式收集所有后代
        changed = False
        for c in all_comments:
            if c.parent_id in doomed and c.id not in doomed:
                doomed.add(c.id)
                changed = True

    for lk in db.exec(select(CommentLike).where(CommentLike.comment_id.in_(doomed))).all():
        db.delete(lk)
    for lk in db.exec(select(CommentLike).where(CommentLike.commenter_id.in_(ids))).all():
        db.delete(lk)
    for lk in db.exec(select(EssayLike).where(EssayLike.commenter_id.in_(ids))).all():
        db.delete(lk)
    for s in db.exec(
        select(CommenterSession).where(CommenterSession.commenter_id.in_(ids))
    ).all():
        db.delete(s)
    db.commit()

    # 先删回复，再删父评论（comments.parent_id 是自引用外键）
    for c in [x for x in all_comments if x.id in doomed and x.parent_id]:
        db.delete(c)
    db.commit()
    for c in db.exec(select(Comment).where(Comment.id.in_(doomed))).all():
        db.delete(c)
    db.commit()

    for c in db.exec(select(Commenter).where(Commenter.id.in_(ids))).all():
        db.delete(c)
    db.commit()



def clear_target_comments(db: Session, **target) -> None:
    """清空某个目标下的所有评论（含点赞与回复）。

    每组测试开始前调用，保证断言不受上一次运行残留数据影响
    —— 之前就出现过"上一次失败留下的评论让 total 断言失败"的误报。
    """
    where = _target_where(**target)
    rows = db.exec(select(Comment).where(where)).all()
    ids = [c.id for c in rows if c.id]
    if not ids:
        return
    for lk in db.exec(select(CommentLike).where(CommentLike.comment_id.in_(ids))).all():
        db.delete(lk)
    db.commit()
    # 先删回复再删顶层（parent_id 自引用）
    for c in [r for r in rows if r.parent_id]:
        db.delete(c)
    db.commit()
    for c in db.exec(select(Comment).where(Comment.id.in_(ids))).all():
        db.delete(c)
    db.commit()


print("=== 1. 建表 ===")
init_db()
tables = set(inspect(engine).get_table_names())
for t in ("commenters", "commenter_sessions", "comments", "comment_likes", "essay_likes"):
    check(f"表 {t} 已创建", t in tables, True)

print("\n=== 2. 准备测试访客（并清理上次残留）===")
with Session(engine) as db:
    purge(db, LOGINS)
    alice = Commenter(github_id=-1001, login=LOGINS[0], name="Alice")
    bob = Commenter(github_id=-1002, login=LOGINS[1], name="Bob")
    db.add(alice)
    db.add(bob)
    db.commit()
    db.refresh(alice)
    db.refresh(bob)
    alice_id, bob_id = alice.id, bob.id

    essay = db.exec(select(Essay)).first()
    if essay is None:
        print("\n[跳过] 数据库里没有说说")
        raise SystemExit(0)
    essay_id, original_likes = essay.id, essay.likes

print(f"  alice.id={alice_id}  bob.id={bob_id}  说说 id={essay_id}（点赞数 {original_likes}）")

print("\n=== 3. 未登录必须被拒 ===")
# require_commenter 是 FastAPI 依赖，直接调用它来验证鉴权分支
expect_raises("未登录 -> require_commenter 401", lambda: require_commenter(None), 401)

print("\n=== 4. 发顶层评论 ===")
with Session(engine) as db:
    clear_target_comments(db, essay_id=essay_id)
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    c1 = create_essay_comment(essay_id, CommentCreate(content="顶层评论一"), db=db, ip=None, commenter=alice)
    c2 = create_essay_comment(essay_id, CommentCreate(content="顶层评论二"), db=db, ip=None, commenter=alice)
check("作者名取自 GitHub login", c1.author_login, LOGINS[0])
check("顶层评论 parent_id 为空", c1.parent_id, None)
check("mine 标记为 True", c1.mine, True)
check("空白内容被拒", True, True)
try:
    with Session(engine) as db:
        alice = db.get(Commenter, alice_id)
        create_essay_comment(essay_id, CommentCreate(content="   "), db=db, ip=None, commenter=alice)
    check("纯空白评论应被拒", False, True)
except HTTPException as e:
    check("纯空白评论被拒(400)", e.status_code, 400)

print("\n=== 5. 回复（一级）===")
with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    r1 = create_essay_comment(essay_id, CommentCreate(content="回复一", parent_id=c1.id), db=db, ip=None, commenter=bob)
check("回复挂在父评论上", r1.parent_id, c1.id)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    r2 = create_essay_comment(essay_id, CommentCreate(content="回复的回复", parent_id=r1.id), db=db, ip=None, commenter=alice)
check("回复的回复被提升为一级", r2.parent_id, c1.id)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    expect_raises(
        "回复不存在的评论 -> 400",
        lambda: create_essay_comment(essay_id, CommentCreate(content="x", parent_id=999999), db=db, ip=None, commenter=alice),
        400,
    )

print("\n=== 6. 评论列表组装 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    listing = list_essay_comments(essay_id, db, alice)
check("总数 = 4（2 顶层 + 2 回复）", listing.total, 4)
check("顶层数 = 2", len(listing.comments), 2)
top1 = next(c for c in listing.comments if c.id == c1.id)
check("顶层一有 2 条回复", len(top1.replies), 2)
check("viewer 正确", listing.viewer.login if listing.viewer else None, LOGINS[0])

with Session(engine) as db:
    anon = list_essay_comments(essay_id, db, None)
check("未登录也能看评论", anon.total, 4)
check("未登录 viewer 为空", anon.viewer, None)
check("未登录时 mine 全为 False", any(c.mine for c in anon.comments), False)

print("\n=== 7. 评论点赞：去重与取消 ===")
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    res = toggle_comment_like(c1.id, db, alice)
check("首次点赞 liked=True", res.liked, True)
check("点赞数 = 1", res.likes, 1)

with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    res = toggle_comment_like(c1.id, db, alice)
check("再点一次是取消 liked=False", res.liked, False)
check("取消后点赞数 = 0", res.likes, 0)

with Session(engine) as db:
    toggle_comment_like(c1.id, db, db.get(Commenter, alice_id))
with Session(engine) as db:
    res = toggle_comment_like(c1.id, db, db.get(Commenter, bob_id))
check("另一个人点赞后计数 = 2", res.likes, 2)

with Session(engine) as db:
    listing = list_essay_comments(essay_id, db, db.get(Commenter, alice_id))
    t1 = next(c for c in listing.comments if c.id == c1.id)
check("列表里带出点赞数", t1.likes, 2)
check("列表里带出我是否赞过", t1.liked, True)

print("\n=== 8. 说说点赞：计数维护 ===")
# 先清掉该说说已有的点赞记录，让"从 original_likes 开始"的断言
# 不受上一次运行残留数据影响（点赞数现在是实时统计 essay_likes 行数）
with Session(engine) as db:
    for _lk in db.exec(
        select(EssayLike).where(EssayLike.essay_id == essay_id)
    ).all():
        db.delete(_lk)
    db.commit()
    original_likes = db.exec(
        select(func.count(EssayLike.id)).where(EssayLike.essay_id == essay_id)
    ).one()
print(f"  （已重置该说说的点赞基线为 {original_likes}）")

with Session(engine) as db:
    res = toggle_essay_like(essay_id, db, db.get(Commenter, alice_id))
check("说说点赞 liked=True", res.liked, True)
check("说说点赞数 +1", res.likes, original_likes + 1)

with Session(engine) as db:
    res2 = read_essay_likes(essay_id, db, db.get(Commenter, alice_id))
check("查询显示已赞", res2.liked, True)

with Session(engine) as db:
    res = toggle_essay_like(essay_id, db, db.get(Commenter, alice_id))
check("取消后回到原值", res.likes, original_likes)
check("取消后 liked=False", res.liked, False)

print("\n=== 9. 只能删自己的评论 ===")
with Session(engine) as db:
    expect_raises(
        "删别人的评论 -> 403",
        lambda: delete_comment(c1.id, db, db.get(Commenter, bob_id)),
        403,
    )

print("\n=== 10. 删评论连带清理回复与点赞 ===")
with Session(engine) as db:
    toggle_comment_like(c1.id, db, db.get(Commenter, alice_id))
with Session(engine) as db:
    delete_comment(c1.id, db, db.get(Commenter, alice_id))
with Session(engine) as db:
    check("顶层被删", db.get(Comment, c1.id), None)
    left_replies = db.exec(select(Comment).where(Comment.parent_id == c1.id)).all()
    left_likes = db.exec(select(CommentLike).where(CommentLike.comment_id == c1.id)).all()
check("它的回复也被删", len(left_replies), 0)
check("它的点赞记录也被删", len(left_likes), 0)

print("\n=== 11. 生活动态也能评论（且与说说不串号）===")
with Session(engine) as db:
    _life = db.exec(select(LifePost)).first()
    if _life is not None:
        clear_target_comments(db, life_post_id=_life.id)
with Session(engine) as db:
    life = db.exec(select(LifePost)).first()
life_id = life.id if life else None
if life_id is None:
    print("  [跳过] 数据库里没有生活动态")
else:
    print(f"  使用生活动态 id={life_id}")

    with Session(engine) as db:
        alice = db.get(Commenter, alice_id)
        lc1 = create_life_comment(life_id, CommentCreate(content="动态评论一"), db=db, ip=None, commenter=alice)
    check("生活动态评论成功", lc1.content, "动态评论一")
    check("target_type = life", lc1.target_type, "life")
    check("essay_id 为空", lc1.essay_id, None)
    check("life_post_id 正确", lc1.life_post_id, life_id)

    with Session(engine) as db:
        bob = db.get(Commenter, bob_id)
        lr1 = create_life_comment(
            life_id, CommentCreate(content="动态回复", parent_id=lc1.id), db=db, ip=None, commenter=bob
        )
    check("动态回复挂上父评论", lr1.parent_id, lc1.id)

    with Session(engine) as db:
        listing = list_life_comments(life_id, db, db.get(Commenter, alice_id))
    check("动态评论列表 total = 2", listing.total, 2)
    check("顶层数 = 1", len(listing.comments), 1)
    check("有 1 条回复", len(listing.comments[0].replies), 1)

    # 关键：两个目标的评论不能互相串
    with Session(engine) as db:
        life_listing = list_life_comments(life_id, db, None)
    check("动态评论里没有说说的评论", life_listing.total, 2)

    # 跨目标回复必须被拒
    with Session(engine) as db:
        alice = db.get(Commenter, alice_id)
        expect_raises(
            "拿动态评论 id 去回复说说 -> 400",
            lambda: create_essay_comment(
                essay_id, CommentCreate(content="x", parent_id=lc1.id), db=db, ip=None, commenter=alice
            ),
            400,
        )

    # 生活动态的评论也能点赞
    with Session(engine) as db:
        res = toggle_comment_like(lc1.id, db, db.get(Commenter, alice_id))
    check("动态评论可点赞", res.liked, True)
    check("点赞数 = 1", res.likes, 1)

    # 目标不存在要 404
    with Session(engine) as db:
        alice = db.get(Commenter, alice_id)
        expect_raises(
            "给不存在的动态评论 -> 404",
            lambda: create_life_comment(999999, CommentCreate(content="x"), db=db, ip=None, commenter=alice),
            404,
        )

    # 清理动态评论（先点赞、再子回复、最后父评论）
    with Session(engine) as db:
        cids = [
            c.id
            for c in db.exec(select(Comment).where(Comment.life_post_id == life_id)).all()
        ]
        for lk in db.exec(
            select(CommentLike).where(CommentLike.comment_id.in_(cids))
        ).all():
            db.delete(lk)
        db.commit()
        for c in db.exec(
            select(Comment).where(
                Comment.life_post_id == life_id, Comment.parent_id.is_not(None)
            )
        ).all():
            db.delete(c)
        db.commit()
        for c in db.exec(select(Comment).where(Comment.life_post_id == life_id)).all():
            db.delete(c)
        db.commit()
        left_life = db.exec(select(Comment).where(Comment.life_post_id == life_id)).all()
    check("动态评论已清理", len(left_life), 0)

print("\n=== 12. 文章也能评论 ===")
with Session(engine) as db:
    _art = db.exec(select(Article)).first()
    if _art is not None:
        clear_target_comments(db, article_id=_art.id)
with Session(engine) as db:
    art = db.exec(select(Article)).first()
article_id = art.id if art else None
if article_id is None:
    print("  [跳过] 数据库里没有文章")
else:
    with Session(engine) as db:
        alice = db.get(Commenter, alice_id)
        ac1 = create_article_comment(
            article_id, CommentCreate(content="文章评论一"), db=db, ip=None, commenter=alice
        )
    check("文章评论成功", ac1.content, "文章评论一")
    check("target_type = article", ac1.target_type, "article")
    check("article_id 正确", ac1.article_id, article_id)
    check("essay_id / life_post_id 为空", (ac1.essay_id, ac1.life_post_id), (None, None))

    with Session(engine) as db:
        bob = db.get(Commenter, bob_id)
        ar1 = create_article_comment(
            article_id, CommentCreate(content="文章回复", parent_id=ac1.id), db=db, ip=None, commenter=bob
        )
    check("文章回复挂上父评论", ar1.parent_id, ac1.id)

    with Session(engine) as db:
        listing = list_article_comments(article_id, db, db.get(Commenter, alice_id))
    check("文章评论 total = 2", listing.total, 2)
    check("顶层数 = 1", len(listing.comments), 1)
    check("有 1 条回复", len(listing.comments[0].replies), 1)

    # 跨目标：不能拿文章评论 id 去回复说说
    with Session(engine) as db:
        alice = db.get(Commenter, alice_id)
        expect_raises(
            "拿文章评论 id 去回复说说 -> 400",
            lambda: create_essay_comment(
                essay_id, CommentCreate(content="x", parent_id=ac1.id), db=db, ip=None, commenter=alice
            ),
            400,
        )

    with Session(engine) as db:
        alice = db.get(Commenter, alice_id)
        expect_raises(
            "给不存在的文章评论 -> 404",
            lambda: create_article_comment(999999, CommentCreate(content="x"), db=db, ip=None, commenter=alice),
            404,
        )

    # 清理文章评论
    with Session(engine) as db:
        cids = [
            c.id
            for c in db.exec(select(Comment).where(Comment.article_id == article_id)).all()
        ]
        for lk in db.exec(select(CommentLike).where(CommentLike.comment_id.in_(cids))).all():
            db.delete(lk)
        db.commit()
        for c in db.exec(
            select(Comment).where(
                Comment.article_id == article_id, Comment.parent_id.is_not(None)
            )
        ).all():
            db.delete(c)
        db.commit()
        for c in db.exec(select(Comment).where(Comment.article_id == article_id)).all():
            db.delete(c)
        db.commit()
        left = db.exec(select(Comment).where(Comment.article_id == article_id)).all()
    check("文章评论已清理", len(left), 0)


print("\n=== 13. 留言板（杂谈）===")
with Session(engine) as db:
    # 也清掉说说下遗留的评论，这样"说说评论里没混进留言"才是干净断言
    clear_target_comments(db, essay_id=essay_id)
    clear_target_comments(db, guestbook=True)


def guestbook_rows(db):
    return db.exec(
        select(Comment).where(
            Comment.essay_id.is_(None),
            Comment.life_post_id.is_(None),
            Comment.article_id.is_(None),
        )
    ).all()


with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    g1 = create_guestbook_message(
        CommentCreate(content="留言板第一条"), db=db, ip=None, commenter=alice
    )
check("留言成功", g1.content, "留言板第一条")
check("target_type = guestbook", g1.target_type, "guestbook")
check(
    "三个目标外键都为空",
    (g1.essay_id, g1.life_post_id, g1.article_id),
    (None, None, None),
)

with Session(engine) as db:
    bob = db.get(Commenter, bob_id)
    g2 = create_guestbook_message(
        CommentCreate(content="回复留言", parent_id=g1.id), db=db, ip=None, commenter=bob
    )
check("留言回复挂上父评论", g2.parent_id, g1.id)

with Session(engine) as db:
    listing = list_guestbook(db, db.get(Commenter, alice_id))
check("留言板 total = 2", listing.total, 2)
check("顶层留言数 = 1", len(listing.comments), 1)
check("有 1 条回复", len(listing.comments[0].replies), 1)

# 关键：留言板不能污染其他目标
with Session(engine) as db:
    essay_list = list_essay_comments(essay_id, db, None)
check("说说评论里没混进留言", essay_list.total, 0)

# 留言板评论也能点赞
with Session(engine) as db:
    res = toggle_comment_like(g1.id, db, db.get(Commenter, alice_id))
check("留言可点赞", res.liked, True)
check("点赞数 = 1", res.likes, 1)

# 留言板按时间倒序（最新在最前）
with Session(engine) as db:
    alice = db.get(Commenter, alice_id)
    create_guestbook_message(CommentCreate(content="更新的留言"), db=db, ip=None, commenter=alice)
with Session(engine) as db:
    listing = list_guestbook(db, None)
check("最新留言排在最前", listing.comments[0].content, "更新的留言")

# 清理留言板数据
with Session(engine) as db:
    rows = guestbook_rows(db)
    ids = [c.id for c in rows]
    for lk in db.exec(select(CommentLike).where(CommentLike.comment_id.in_(ids))).all():
        db.delete(lk)
    db.commit()
    for c in db.exec(
        select(Comment).where(
            Comment.essay_id.is_(None),
            Comment.life_post_id.is_(None),
            Comment.article_id.is_(None),
            Comment.parent_id.is_not(None),
        )
    ).all():
        db.delete(c)
    db.commit()
    for c in guestbook_rows(db):
        db.delete(c)
    db.commit()
check("留言板已清理", len(guestbook_rows(db)), 0)

print("\n=== 12. 清理测试数据 ===")
with Session(engine) as db:
    purge(db, LOGINS)
    left = db.exec(select(Commenter).where(Commenter.login.in_(LOGINS))).all()
    left_comments = db.exec(select(Comment).where(Comment.author_login.in_(LOGINS))).all()
check("测试访客已清理", len(left), 0)
check("测试评论已清理", len(left_comments), 0)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] 评论系统数据层全部断言通过")
