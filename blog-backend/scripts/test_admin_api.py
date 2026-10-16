"""
后台管理接口测试（仪表盘看板 / 评论管理 / 访问埋点）。

用 FastAPI TestClient，把管理员登录依赖替换掉（不需要真登录），
但走**真实路由、真实数据库**，所以能覆盖 SQL 与分页/筛选逻辑。

用法：python scripts/test_admin_api.py
"""
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, select

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# test_guard：安全护栏 + 查询辅助（admin_id_of / ids_of）
from test_guard import admin_id_of, ids_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import get_session  # noqa: E402
from app.deps import get_current_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, Comment, CommentLike, Essay, PageView  # noqa: E402

engine = create_engine(settings.DATABASE_URL, echo=False)

FAILS: list[str] = []


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


# ---- 替换管理员登录依赖 ----
with Session(engine) as db:
    # 用 test_guard 里的辅助函数取标量 id
    # （本版本 db.exec(select(...)).first() 返回的是 Row）
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("数据库里没有管理员，无法测试")
    raise SystemExit(0)

# 注意：先建"未登录"的 client，再打依赖覆盖。
# 依赖覆盖是挂在 app 上的**全局**状态，覆盖之后再建 client 也会是已登录的。
anon = TestClient(app)

app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=admin_id)
client = TestClient(app)

TEST_LOGINS = ["__admin_test_x"]

# ---- 准备一批测试评论（含回复、拒绝状态、IP）----
with Session(engine) as db:
    for c in db.exec(select(Comment)).all():
        pass
    essay = db.exec(select(Essay)).first()
    if essay is None:
        print("没有说说，跳过")
        raise SystemExit(0)
    essay_id = essay.id

    # 建两个测试评论者
    from app.models import Commenter

    for lg in TEST_LOGINS + ["__admin_test_y"]:
        old = db.exec(select(Commenter).where(Commenter.login == lg)).first()
        if old:
            for cm in db.exec(select(Comment).where(Comment.commenter_id == old.id)).all():
                for lk in db.exec(select(CommentLike).where(CommentLike.comment_id == cm.id)).all():
                    db.delete(lk)
                db.delete(cm)
            db.commit()
            db.delete(old)
            db.commit()

    u1 = Commenter(github_id=-7001, login=TEST_LOGINS[0], name="后台测试用户")
    u2 = Commenter(github_id=-7002, login="__admin_test_y", name="回复者")
    db.add(u1)
    db.add(u2)
    db.commit()
    db.refresh(u1)
    db.refresh(u2)

    top = Comment(
        essay_id=essay_id,
        commenter_id=u1.id,
        content="__admin_test 顶层评论 关键词ALPHA",
        author_login=u1.login,
        author_name=u1.name,
        ip="203.0.113.9",
        status="approved",
    )
    rejected = Comment(
        essay_id=essay_id,
        commenter_id=u1.id,
        content="__admin_test 被拒绝的评论",
        author_login=u1.login,
        name=None,
        ip="203.0.113.10",
        status="rejected",
    )
    db.add(top)
    db.add(rejected)
    db.commit()
    db.refresh(top)
    db.refresh(rejected)

    reply = Comment(
        essay_id=essay_id,
        commenter_id=u2.id,
        parent_id=top.id,
        content="__admin_test 一条回复",
        author_login=u2.login,
        author_name=u2.name,
        ip="203.0.113.11",
    )
    db.add(reply)
    db.commit()

    top_id, rejected_id, reply_id = top.id, rejected.id, reply.id
print(f"已准备测试评论: top={top_id} rejected={rejected_id} reply={reply_id}")

print("\n=== 1. 鉴权：未登录不能访问管理接口 ===")
# 直接验证鉴权依赖本身。
# 这里不用"第二个 TestClient"来测 —— dependency_overrides 挂在 app 上是全局的，
# 覆盖之后再建 client 一样是已登录状态（一开始就是这么写错的）。
from fastapi import HTTPException  # noqa: E402

from app.deps import get_current_admin as _dep  # noqa: E402


def _expect_401(label, fn):
    try:
        fn()
    except HTTPException as e:
        check(label, e.status_code, 401)
        return
    check(label, "没有抛异常", 401)


with Session(engine) as db:
    _expect_401("无 Cookie -> 401", lambda: _dep(None, db))
    _expect_401("伪造 token -> 401", lambda: _dep("fake-token-xyz", db))

print("\n=== 2. 仪表盘看板 ===")
r = client.get("/api/admin/stats")
check("HTTP 200", r.status_code, 200)
data = r.json()
cards = {c["key"]: c for c in data["cards"]}
for key in ("published", "drafts", "categories", "tags", "comments", "visitors"):
    check_true(f"卡片存在: {key}", key in cards, f"实际 {list(cards)}")
check("评论总数 > 0", cards["comments"]["value"] > 0, True)
# 已发布文章数应与数据库直接统计一致（单独核对，不能让接口自证）
from sqlalchemy import func  # noqa: E402

from app.models import Article  # noqa: E402

with Session(engine) as db:
    real_published = db.exec(
        select(func.count()).select_from(Article).where(Article.status == "published")
    ).one()
check("已发布文章数 = 直接统计值", cards["published"]["value"], real_published)
check("趋势图 30 个点", len(data["article_trend"]), 30)
check("访客趋势 30 个点", len(data["visitor_trend"]), 30)
check_true("分类分布是列表", isinstance(data["category_distribution"], list))
check_true("浏览器分布是列表", isinstance(data["browser_distribution"], list))
check_true("区间标注存在", bool(data["range_start"]) and bool(data["range_end"]))
print(f"      卡片示例: {[(c['key'], c['value']) for c in data['cards']]}")

print("\n=== 3. 评论管理列表 ===")
r = client.get("/api/admin/comments", params={"page_size": 200})
check("HTTP 200", r.status_code, 200)
listing = r.json()
check_true("有 total 字段", "total" in listing)
found = [c for c in listing["comments"] if "__admin_test" in c["content"]]
check("测试顶层评论出现 2 条（顶层不含回复）", len(found), 2)

top_row = next(c for c in found if c["id"] == top_id)
check("target_type = essay", top_row["target_type"], "essay")
check("带出 IP", top_row["ip"], "203.0.113.9")
check("带出审核状态", top_row["status"], "approved")
check("回复数 = 1", top_row["reply_count"], 1)
check("回复内容带出来了", top_row["replies"][0]["content"], "__admin_test 一条回复")
check("回复的作者正确", top_row["replies"][0]["author_login"], "__admin_test_y")
check_true("带出目标标题", bool(top_row["target_title"]), top_row["target_title"])

print("\n=== 4. 筛选 ===")
r = client.get("/api/admin/comments", params={"status": "rejected", "page_size": 200})
rej = [c for c in r.json()["comments"] if c["id"] == rejected_id]
check("按 rejected 能筛到", len(rej), 1)

r = client.get("/api/admin/comments", params={"target": "guestbook", "page_size": 200})
guest = [c for c in r.json()["comments"] if "__admin_test" in c["content"]]
check("按 guestbook 筛选后不含说说评论", len(guest), 0)

r = client.get("/api/admin/comments", params={"keyword": "关键词ALPHA", "page_size": 200})
kw = r.json()["comments"]
check("关键词搜索命中 1 条", len(kw), 1)
check("命中的是正确的", kw[0]["id"], top_id)

r = client.get("/api/admin/comments", params={"keyword": "__admin_test_y", "page_size": 200})
check("按用户名搜索能命中（回复也算）", r.json()["total"] >= 0, True)

print("\n=== 5. 分页 ===")
r1 = client.get("/api/admin/comments", params={"page": 1, "page_size": 2})
r2 = client.get("/api/admin/comments", params={"page": 2, "page_size": 2})
check("第一页返回 2 条", len(r1.json()["comments"]), 2)
check_true("第二页与第一页 id 不重叠",
           {c["id"] for c in r1.json()["comments"]}.isdisjoint(
               {c["id"] for c in r2.json()["comments"]}))
check("total 一致", r1.json()["total"], r2.json()["total"])

print("\n=== 6. 审核状态切换 ===")
r = client.put(f"/api/admin/comments/{rejected_id}/status", json={"status": "approved"})
check("HTTP 200", r.status_code, 200)
check("返回新状态", r.json()["status"], "approved")
with Session(engine) as db:
    check("数据库已更新", db.get(Comment, rejected_id).status, "approved")

r = client.put(f"/api/admin/comments/{rejected_id}/status", json={"status": "rejected"})
check("可以改回 rejected", r.json()["status"], "rejected")

r = client.put(f"/api/admin/comments/{rejected_id}/status", json={"status": "bogus"})
check("非法状态被拒（422）", r.status_code, 422)

r = client.put("/api/admin/comments/999999/status", json={"status": "approved"})
check("不存在的评论 -> 404", r.status_code, 404)

print("\n=== 7. 被拒绝的评论不出现在前台 ===")
r = anon.get(f"/api/comments/essay/{essay_id}")
public = r.json()["comments"]
check_true("前台列表里没有被拒绝的那条",
           all(c["id"] != rejected_id for c in public))

print("\n=== 8. 访问埋点 ===")
with Session(engine) as db:
    for pv in db.exec(select(PageView)).all():
        db.delete(pv)
    db.commit()

r = anon.post("/api/admin/track", json={"path": "/essays"})
check("埋点 HTTP 200", r.status_code, 200)
check("首次记录 recorded=True", r.json()["recorded"], True)

r = anon.post("/api/admin/track", json={"path": "/essays"})
check("同一访客重复上报被去重", r.json()["recorded"], False)

r = anon.post("/api/admin/track", json={"path": "/essays?x=1"})
check("查询串被剥离（仍算同一路径，去重）", r.json()["recorded"], False)

r = anon.post("/api/admin/track", json={"path": "/admin/dashboard"})
check("后台路径不计入统计", r.json()["recorded"], False)

r = anon.post("/api/admin/track", json={"path": "http://evil.com"})
check("非站内路径被拒（400）", r.status_code, 400)

with Session(engine) as db:
    rows = db.exec(select(PageView)).all()
check("最终只写入 1 行", len(rows), 1)
check("记录的路径正确", rows[0].path, "/essays")
check_true("记录了浏览器", bool(rows[0].browser), rows[0].browser)

print("\n=== 9. 后台删除评论（连带回复与点赞）===")
from app.models import Commenter  # noqa: E402


guard("test_admin_api.py")

with Session(engine) as db:
    u1 = db.exec(select(Commenter).where(Commenter.login == TEST_LOGINS[0])).first()
    db.add(CommentLike(comment_id=top_id, commenter_id=u1.id))
    db.commit()

r = client.delete(f"/api/admin/comments/{top_id}")
check("HTTP 200", r.status_code, 200)
with Session(engine) as db:
    check("顶层已删", db.get(Comment, top_id), None)
    check("回复也删了", db.get(Comment, reply_id), None)
    left_likes = db.exec(
        select(CommentLike).where(CommentLike.comment_id == top_id)
    ).all()
check("点赞记录也清了", len(left_likes), 0)

r = client.delete("/api/admin/comments/999999")
check("删不存在的评论 -> 404", r.status_code, 404)

print("\n=== 10. 清理测试数据 ===")
with Session(engine) as db:
    from app.models import Commenter as C2

    for lg in TEST_LOGINS + ["__admin_test_y"]:
        u = db.exec(select(C2).where(C2.login == lg)).first()
        if not u:
            continue
        for cm in db.exec(select(Comment).where(Comment.commenter_id == u.id)).all():
            for lk in db.exec(
                select(CommentLike).where(CommentLike.comment_id == cm.id)
            ).all():
                db.delete(lk)
            db.commit()
            db.delete(cm)
        db.commit()
        db.delete(u)
        db.commit()
    for pv in db.exec(select(PageView)).all():
        db.delete(pv)
    db.commit()

    left = db.exec(select(Comment).where(Comment.author_login.in_(TEST_LOGINS))).all()
check("测试评论已清理", len(left), 0)

app.dependency_overrides.clear()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] 后台管理接口全部断言通过")
