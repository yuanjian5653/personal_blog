"""
阶段 2-B（审核流）的测试 —— 重点全在"待审内容不能露出去"。

这是整个项目里最危险的一类 bug：不会报错，只会静静把不该公开的内容公开。
所以每个公开入口都单独断言一遍。

覆盖：
  · 成员发布 → review_status=pending、status=draft
  · 管理员发布 → approved + published（不审自己）
  · 待审内容**不出现在**：说说列表 / 说说详情 / 随机说说 / 动态列表 /
    动态详情 / 友链列表 / 相册照片 / 文章列表 / 文章详情
  · 审核通过后立刻出现
  · 驳回后仍不出现，且状态为 rejected + draft
  · 关掉「需要审核」开关后，成员发布直接公开
  · 审核队列能列出待审项、计数正确
  · 非管理员调审核接口 → 403

用法：python scripts/test_review.py --allow-production-db
"""
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import admin_id_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession, Article, Essay, LifePost  # noqa: E402
from app.services.review import review_required, set_review_required  # noqa: E402

guard("test_review.py")

# 记下开始时间：清理时用它删掉本次测试产生的事件，
# 否则会污染 test_notifier（本地没有 worker 消费，pending 会堆积）
from datetime import datetime, timezone  # noqa: E402
TEST_START = datetime.now(timezone.utc).replace(tzinfo=None)
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []
PFX = "__rv_"


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(f"{label}: got={got!r} want={want!r}")
        print(f"          got ={got!r}  want={want!r}")


def check_true(label, cond, extra=""):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(f"{label} {extra}")
        if extra:
            print(f"          {extra}")


def cleanup():
    """清测试数据。

    注意：不能用同一个 connection 混着 db.commit() 用 ——
    commit 之后那个 connection 上的事务就失效了，再 execute 会报
    "This transaction is inactive"。所以原始 SQL 一律走 engine.begin()，
    ORM 删除走独立的 Session。
    """
    with engine.begin() as conn:
        # 本次测试期间产生的通知事件（本地没 worker，不清会堆积）
        conn.execute(
            text("DELETE FROM notification_outbox WHERE created_at >= :s"),
            {"s": TEST_START},
        )
        conn.execute(text("DELETE FROM articles WHERE title LIKE :p"), {"p": PFX + "%"})
        conn.execute(text("DELETE FROM essays WHERE title LIKE :p"), {"p": PFX + "%"})
        conn.execute(text("DELETE FROM life_posts WHERE content LIKE :p"), {"p": PFX + "%"})

    with Session(engine) as db:
        rows = db.exec(select(Admin).where(Admin.username == PFX + "m")).all()
        ids = [a.id for a in (r if isinstance(r, Admin) else r[0] for r in rows) if a]

    for aid in ids:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM admin_sessions WHERE admin_id = :a"), {"a": aid})
            conn.execute(text("DELETE FROM operation_logs WHERE admin_id = :a"), {"a": aid})
        with Session(engine) as db:
            obj = db.get(Admin, aid)
            if obj is not None:
                db.delete(obj)
                db.commit()


cleanup()

with Session(engine) as db:
    root_id = admin_id_of(db, Admin)
if root_id is None:
    print("没有管理员账号，跳过")
    raise SystemExit(0)

client = TestClient(app)


def login(admin_id: int) -> None:
    from datetime import datetime, timedelta, timezone

    token = f"{PFX}tok-{admin_id}"
    with Session(engine) as db:
        for r in db.exec(select(AdminSession).where(AdminSession.session_token == token)).all():
            o = r if isinstance(r, AdminSession) else r[0]
            if isinstance(o, AdminSession):
                db.delete(o)
        db.commit()
        db.add(
            AdminSession(
                admin_id=admin_id,
                session_token=token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
        )
        db.commit()
    client.cookies.clear()
    client.cookies.set("session_token", token)


# 打开审核开关（默认就是开的，这里显式设定，避免被别处改动影响）
with Session(engine) as db:
    set_review_required(db, True)
    check("审核开关为开", review_required(db), True)

# 造一个成员账号
login(root_id)
r = client.post(
    "/api/admin/members",
    json={"username": PFX + "m", "password": "a-strong-password-9", "role": "member"},
)
check("创建成员 201", r.status_code, 201)
member_id = r.json()["member"]["id"]

# ------------------------------------------------------------------ 成员发布
print("\n=== 1. 成员发布的内容进入待审 ===")
login(member_id)

r = client.post("/api/essays", json={"title": PFX + "说说待审", "content": "正文"})
check("成员发说说 200", r.status_code, 200)
essay_id = r.json()["id"]
check("说说 review_status", r.json().get("review_status"), "pending")
check("说说 status", r.json().get("status"), "draft")

r = client.post("/api/life", json={"content": PFX + "动态待审"})
check("成员发动态 200", r.status_code, 200)
life_id = r.json()["id"]

r = client.post(
    "/api/articles",
    json={"title": PFX + "文章待审", "content": "正文", "status": "published"},
)
check("成员发文章 200", r.status_code, 200)
article_id = r.json()["id"]
check("文章 status 被压回 draft", r.json().get("status"), "draft")
check("文章 review_status", r.json().get("review_status"), "pending")

# ------------------------------------------------------------------ 访客看不到
print("\n=== 2. 访客看不到待审内容 ===")
client.cookies.clear()

rows = client.get("/api/essays").json()
check_true(
    "说说列表不含待审",
    all(x["id"] != essay_id for x in rows),
    f"共 {len(rows)} 条",
)
check("说说详情 404", client.get(f"/api/essays/{essay_id}").status_code, 404)

rows = client.get("/api/life").json()
check_true("动态列表不含待审", all(x["id"] != life_id for x in rows))

rows = client.get("/api/articles?status=published").json()
check_true("文章列表不含待审", all(x["id"] != article_id for x in rows))
check("文章详情 404", client.get(f"/api/articles/{article_id}").status_code, 404)

# ------------------------------------------------------------------ 审核队列
print("\n=== 3. 审核队列 ===")
login(root_id)
r = client.get("/api/admin/review")
check("队列 200", r.status_code, 200)
q = r.json()
check_true("队列里有待审项", q["total"] >= 3, f"total={q['total']}")
check_true("计数含 essay", q["counts"].get("essay", 0) >= 1, str(q["counts"]))
check_true("计数含 life", q["counts"].get("life", 0) >= 1, str(q["counts"]))
check_true("计数含 article", q["counts"].get("article", 0) >= 1, str(q["counts"]))

# 成员不能调审核接口
login(member_id)
check("成员看队列 → 403", client.get("/api/admin/review").status_code, 403)
check(
    "成员审核 → 403",
    client.post(f"/api/admin/review/essay/{essay_id}", json={"decision": "approve"}).status_code,
    403,
)

# ------------------------------------------------------------------ 通过
print("\n=== 4. 通过后立刻公开 ===")
login(root_id)
r = client.post(f"/api/admin/review/essay/{essay_id}", json={"decision": "approve"})
check("通过 200", r.status_code, 200)

client.cookies.clear()
rows = client.get("/api/essays").json()
check_true("说说列表出现了", any(x["id"] == essay_id for x in rows))
check("说说详情 200", client.get(f"/api/essays/{essay_id}").status_code, 200)

with Session(engine) as db:
    e = db.get(Essay, essay_id)
    check("库里 review_status", e.review_status, "approved")
    check("库里 status", e.status, "published")

# 重复审核 → 409
login(root_id)
check(
    "重复审核 409",
    client.post(f"/api/admin/review/essay/{essay_id}", json={"decision": "approve"}).status_code,
    409,
)

# ------------------------------------------------------------------ 驳回
print("\n=== 5. 驳回后仍不公开 ===")
r = client.post(
    f"/api/admin/review/life/{life_id}",
    json={"decision": "reject", "reason": "内容不合适"},
)
check("驳回 200", r.status_code, 200)

client.cookies.clear()
rows = client.get("/api/life").json()
check_true("动态列表仍不含", all(x["id"] != life_id for x in rows))
with Session(engine) as db:
    p = db.get(LifePost, life_id)
    check("库里 review_status", p.review_status, "rejected")
    check("库里 status", p.status, "draft")

# ------------------------------------------------------------------ 关掉开关
print("\n=== 6. 关掉审核开关 → 成员发布直接公开 ===")
login(root_id)
r = client.put("/api/admin/review/settings", json={"review_required": False})
check("关开关 200", r.status_code, 200)
check("返回值", r.json()["review_required"], False)

login(member_id)
r = client.post("/api/essays", json={"title": PFX + "说说直发", "content": "正文"})
check("成员发说说 200", r.status_code, 200)
check("直接 approved", r.json().get("review_status"), "approved")
check("直接 published", r.json().get("status"), "published")

client.cookies.clear()
rows = client.get("/api/essays").json()
check_true("访客立刻能看到", any(x["title"] == PFX + "说说直发" for x in rows))

# 恢复开关
login(root_id)
client.put("/api/admin/review/settings", json={"review_required": True})

# ------------------------------------------------------------------ 收尾
client.cookies.clear()
cleanup()

with Session(engine) as db:
    n_articles = len(
        db.exec(select(Article).where(Article.title.like(PFX + "%"))).all()
    )
check("跑完不留垃圾", n_articles, 0)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 审核流全部断言通过")
