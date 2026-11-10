"""图片组审核全流程验证（成员视角 → 访客视角 → 审核 → 再编辑）。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import guard  # noqa: E402

guard("test_album_review.py")

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, select

from app.database import engine
from app.main import app
from app.models import Admin, AdminSession

c = TestClient(app)
FAILS = []
PFX = "__al_"


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}: {got!r}" + ("" if ok else f" (期望 {want!r})"))
    if not ok:
        FAILS.append(label)


def login(admin_id):
    with Session(engine) as db:
        row = db.exec(
            select(AdminSession).where(AdminSession.admin_id == admin_id)
        ).first()
        s = row if isinstance(row, AdminSession) else (row[0] if row else None)
        token = s.session_token if s else None
    c.cookies.clear()
    if token:
        c.cookies.set("session_token", token)


with Session(engine) as db:
    admins = [r if isinstance(r, Admin) else r[0] for r in db.exec(select(Admin)).all()]
    root = next(a for a in admins if a.role == "admin")
    member = next(a for a in admins if a.role == "member" and a.status == "active")

# ---------------------------------------------------------------- 成员创建
print("\n=== 1. 成员创建图片组 → 待审，但后台自己能看见 ===")
login(member.id)
r = c.post("/api/albums", json={"name": PFX + "组", "description": "测试"})
check("创建 200", r.status_code, 200)
album_id = r.json()["id"]
check("review_status", r.json().get("review_status"), "pending")

r = c.get("/api/albums?mine=1")
mine = [a for a in r.json() if a["id"] == album_id]
check("后台「只看我的」能看到", len(mine), 1)

# ---------------------------------------------------------------- 访客看不到
print("\n=== 2. 访客看不到待审图片组 ===")
c.cookies.clear()
r = c.get("/api/albums")
check("访客列表不含它", any(a["id"] == album_id for a in r.json()), False)
r = c.get(f"/api/albums/{album_id}")
check("访客详情 404", r.status_code, 404)

# ---------------------------------------------------------------- 通过前可编辑
print("\n=== 3. 通过前可以自由编辑 ===")
login(member.id)
r = c.put(f"/api/albums/{album_id}", json={"description": "改过的描述"})
check("编辑 200", r.status_code, 200)
check("仍是 pending", r.json().get("review_status"), "pending")

# ---------------------------------------------------------------- 管理员审核通过
print("\n=== 4. 管理员审核通过 → 前台可见 ===")
login(root.id)
r = c.post(f"/api/admin/review/album/{album_id}", json={"decision": "approve"})
check("通过 200", r.status_code, 200)

c.cookies.clear()
r = c.get("/api/albums")
check("访客列表包含它", any(a["id"] == album_id for a in r.json()), True)
r = c.get(f"/api/albums/{album_id}")
check("访客详情 200", r.status_code, 200)

# ---------------------------------------------------------------- 通过后编辑 → 重审
print("\n=== 5. 通过后再编辑 → 重新进待审 ===")
login(member.id)
r = c.put(f"/api/albums/{album_id}", json={"description": "又改了一次"})
check("编辑 200", r.status_code, 200)
check("回到 pending", r.json().get("review_status"), "pending")

c.cookies.clear()
r = c.get("/api/albums")
check("访客又看不到了", any(a["id"] == album_id for a in r.json()), False)

# ---------------------------------------------------------------- 管理员编辑不重审
print("\n=== 6. 管理员编辑不触发重审 ===")
login(root.id)
c.post(f"/api/admin/review/album/{album_id}", json={"decision": "approve"})
r = c.put(f"/api/albums/{album_id}", json={"description": "管理员改的"})
check("管理员编辑后仍 approved", r.json().get("review_status"), "approved")

# ---------------------------------------------------------------- 清理
c.cookies.clear()
with engine.begin() as conn:
    conn.execute(text("DELETE FROM photos WHERE album_id = :a"), {"a": album_id})
    conn.execute(text("DELETE FROM albums WHERE id = :a"), {"a": album_id})
print("\n  测试数据已清理")

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项: {FAILS}")
    raise SystemExit(1)
print("[通过] 图片组审核全流程正确")
