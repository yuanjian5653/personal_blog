"""
「编辑后重新提交审核」的测试。

覆盖三条路径（说说明细走完，文章再走一遍，确认各表行为一致）：

  1. 成员发 → pending
  2. 管理员驳回 → rejected + draft + 有 review_note
  3. 成员编辑 → **回到 pending**（这就是"重新提交"），且旧的驳回理由被清掉
  4. 管理员通过 → approved + published
  5. 成员再编辑 → 又回到 pending（按新版本重审）
  6. 管理员编辑 → 状态不变（自审自己没意义）

第 5 条曾经是漏的：resubmit_on_edit 只处理 approved，
被驳回的内容改完还是 rejected，永远进不了待审队列。

用法：python scripts/test_resubmit.py --allow-production-db
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from test_guard import guard  # noqa: E402

from app.database import engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession  # noqa: E402

guard("test_resubmit.py")
init_db()

client = TestClient(app)
FAILS: list[str] = []
PFX = "__rs_"


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}: {got!r}" + ("" if ok else f" (期望 {want!r})"))
    if not ok:
        FAILS.append(label)


def check_true(label, cond):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(label)


def login(admin_id: int) -> None:
    token = f"{PFX}tok-{admin_id}"
    with Session(engine) as db:
        for r in db.exec(
            select(AdminSession).where(AdminSession.session_token == token)
        ).all():
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


def purge_stale() -> None:
    with engine.connect() as c:
        ids = [
            r[0]
            for r in c.execute(
                text("SELECT id FROM admin WHERE username LIKE :p"), {"p": PFX + "%"}
            ).fetchall()
        ]
    with engine.begin() as c:
        for tbl in ("essays", "articles"):
            c.execute(
                text(f"DELETE FROM {tbl} WHERE title LIKE :p"), {"p": PFX + "%"}
            )
        for i in ids:
            for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
                c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": i})
            c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": i})
    if ids:
        print(f"  清理残留: {ids}")


purge_stale()

with Session(engine) as db:
    admins = [r if isinstance(r, Admin) else r[0] for r in db.exec(select(Admin)).all()]
    root = next(a for a in admins if a.role == "admin")

login(root.id)
r = client.post(
    "/api/admin/members",
    json={"username": PFX + "m", "password": "a-strong-password-9", "role": "member"},
)
check("创建测试成员 201", r.status_code, 201)
member_id = r.json()["member"]["id"]


def walk(post_url: str, put_url: str, create_body: dict, edit_body: dict, review_kind: str, label: str):
    """走完一条完整路径。"""
    print(f"\n### {label} ###")

    login(member_id)
    r = client.post(post_url, json=create_body)
    check("成员发布 200", r.status_code, 200)
    item_id = r.json()["id"]
    check("初始 pending", r.json().get("review_status"), "pending")

    # 驳回
    login(root.id)
    r = client.post(
        f"/api/admin/review/{review_kind}/{item_id}",
        json={"decision": "reject", "reason": "内容不够充实"},
    )
    check("驳回 200", r.status_code, 200)

    login(member_id)
    detail_url = put_url.format(id=item_id)
    r = client.get(detail_url)
    if r.status_code == 200:
        check("被驳回", r.json().get("review_status"), "rejected")
        check("有驳回理由", r.json().get("review_note"), "内容不够充实")

    # 关键：驳回后编辑 → 回到 pending
    r = client.put(detail_url, json=edit_body)
    check("驳回后编辑 200", r.status_code, 200)
    check("重新回到 pending", r.json().get("review_status"), "pending")
    check("旧驳回理由已清空", r.json().get("review_note"), None)
    check("状态回到 draft", r.json().get("status"), "draft")

    # 通过
    login(root.id)
    r = client.post(
        f"/api/admin/review/{review_kind}/{item_id}", json={"decision": "approve"}
    )
    check("通过 200", r.status_code, 200)

    login(member_id)
    r = client.get(detail_url)
    check("已通过", r.json().get("review_status"), "approved")
    check("已发布", r.json().get("status"), "published")

    # 通过后编辑 → 又回 pending
    r = client.put(detail_url, json=edit_body)
    check("通过后编辑 → 重回 pending", r.json().get("review_status"), "pending")

    # 管理员编辑不重审
    login(root.id)
    client.post(f"/api/admin/review/{review_kind}/{item_id}", json={"decision": "approve"})
    r = client.put(detail_url, json=edit_body)
    check("管理员编辑不重审", r.json().get("review_status"), "approved")

    return item_id


essay_id = walk(
    "/api/essays",
    "/api/essays/{id}",
    {"title": PFX + "说说", "content": "第一版内容"},
    {"title": PFX + "说说", "content": "按意见改过的内容"},
    "essay",
    "说说：驳回 → 改 → 重新提交",
)

article_id = walk(
    "/api/articles",
    "/api/articles/{id}",
    {"title": PFX + "文章", "content": "第一版正文", "status": "published"},
    {"title": PFX + "文章", "content": "改过的正文", "status": "published"},
    "article",
    "文章：驳回 → 改 → 重新提交",
)

# ---------------------------------------------------------------- 收尾
client.cookies.clear()
with engine.begin() as c:
    c.execute(text("DELETE FROM essays WHERE title LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM articles WHERE title LIKE :p"), {"p": PFX + "%"})
    for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
        c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": member_id})
    c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": member_id})

with engine.connect() as c:
    left = c.execute(
        text("SELECT COUNT(*) FROM essays WHERE title LIKE :p"), {"p": PFX + "%"}
    ).scalar()
    left_a = c.execute(
        text("SELECT COUNT(*) FROM articles WHERE title LIKE :p"), {"p": PFX + "%"}
    ).scalar()
check("测试说说清理干净", left, 0)
check("测试文章清理干净", left_a, 0)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项: {FAILS}")
    raise SystemExit(1)
print("[通过] 编辑重新提交审核全部正确")
