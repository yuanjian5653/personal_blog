"""
成员自定义主题的测试。

覆盖：
  · 成员读自己的主题（没存过时返回默认值，不写库）
  · 成员保存 → 幂等再存（不会插两条）
  · 未上线时 /api/themes 里没有
  · 管理员上线 → 出现在 /api/themes
  · 管理员下线 → 又消失
  · 成员不能看全量列表、不能自己上线（403）
  · 账号停用后主题不再对外露出
  · 参数校验（overlay 超范围 422）

用法：python scripts/test_theme.py --allow-production-db
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

guard("test_theme.py")
init_db()

client = TestClient(app)
FAILS: list[str] = []
PFX = "__th_"


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
    for i in ids:
        with engine.begin() as c:
            c.execute(text("DELETE FROM member_themes WHERE admin_id = :i"), {"i": i})
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

# ---------------------------------------------------------------- 1. 默认值
print("\n=== 1. 成员读自己的主题（未存过）===")
login(member_id)
r = client.get("/api/admin/my-theme")
check("读 200", r.status_code, 200)
check("默认未上线", r.json()["is_published"], False)
check("默认强调色", r.json()["theme_accent"], "#7c5cff")

with engine.connect() as c:
    n = c.execute(
        text("SELECT COUNT(*) FROM member_themes WHERE admin_id = :i"), {"i": member_id}
    ).scalar()
check("读不写库（记录数 0）", n, 0)

# ---------------------------------------------------------------- 2. 保存
print("\n=== 2. 成员保存主题 ===")
r = client.put(
    "/api/admin/my-theme",
    json={
        "name": PFX + "星空紫",
        "theme_accent": "#a855f7",
        "bg_type": "color",
        "bg_color": "#0a0612",
        "bg_image": "",
        "bg_blur": 4,
        "bg_overlay": 0.3,
        "card_style": "black",
        "card_text": "测试文字",
        "card_wave_color1": "#a855f7",
        "card_wave_color2": "#22d3ee",
        "home_album_id": None,
    },
)
check("保存 200", r.status_code, 200)
check("强调色已存", r.json()["theme_accent"], "#a855f7")
check("未上线（成员自己不能上线）", r.json()["is_published"], False)

# 再存一次：应更新而不是插新行
client.put("/api/admin/my-theme", json={"name": PFX + "改过的名字", "theme_accent": "#a855f7"})
with engine.connect() as c:
    n = c.execute(
        text("SELECT COUNT(*) FROM member_themes WHERE admin_id = :i"), {"i": member_id}
    ).scalar()
check("重复保存不插新行", n, 1)

# ---------------------------------------------------------------- 3. 未上线不可见
print("\n=== 3. 未上线 → 前台看不到 ===")
client.cookies.clear()
rows = client.get("/api/themes").json()
check("列表里没有", any(t["admin_id"] == member_id for t in rows), False)

# ---------------------------------------------------------------- 4. 上线
print("\n=== 4. 管理员上线 → 前台可见 ===")
login(root.id)
r = client.put(f"/api/admin/themes/{member_id}/publish", json={"is_published": True})
check("上线 200", r.status_code, 200)
check("状态", r.json()["is_published"], True)

client.cookies.clear()
rows = client.get("/api/themes").json()
mine = [t for t in rows if t["admin_id"] == member_id]
check("列表里有它", len(mine), 1)
if mine:
    check("主题名正确", mine[0]["name"], PFX + "改过的名字")
    check("带强调色", mine[0]["theme_accent"], "#a855f7")

# ---------------------------------------------------------------- 5. 下线
print("\n=== 5. 管理员下线 → 又消失 ===")
login(root.id)
r = client.put(f"/api/admin/themes/{member_id}/publish", json={"is_published": False})
check("下线 200", r.status_code, 200)

client.cookies.clear()
rows = client.get("/api/themes").json()
check("列表里没有了", any(t["admin_id"] == member_id for t in rows), False)

# ---------------------------------------------------------------- 6. 越权
print("\n=== 6. 成员越权 ===")
login(member_id)
r = client.get("/api/admin/themes")
check_true("成员看全量列表被拒", r.status_code in (401, 403))
r = client.put(f"/api/admin/themes/{member_id}/publish", json={"is_published": True})
check_true("成员自己上线被拒", r.status_code in (401, 403))

# ---------------------------------------------------------------- 7. 参数校验
print("\n=== 7. 参数校验 ===")
r = client.put("/api/admin/my-theme", json={"name": "x", "bg_overlay": 5})
check("遮罩超出 0~1 → 422", r.status_code, 422)

# ---------------------------------------------------------------- 8. 停用账号
print("\n=== 8. 账号停用后主题不再露出 ===")
login(root.id)
client.put(f"/api/admin/themes/{member_id}/publish", json={"is_published": True})
client.put(f"/api/admin/members/{member_id}", json={"status": "disabled"})

client.cookies.clear()
rows = client.get("/api/themes").json()
check("停用后列表里没有", any(t["admin_id"] == member_id for t in rows), False)

# ---------------------------------------------------------------- 收尾
client.cookies.clear()
with engine.begin() as c:
    c.execute(text("DELETE FROM member_themes WHERE admin_id = :i"), {"i": member_id})
    for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
        c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": member_id})
    c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": member_id})

with engine.connect() as c:
    left = c.execute(
        text("SELECT COUNT(*) FROM member_themes WHERE admin_id = :i"), {"i": member_id}
    ).scalar()
check("主题记录清理干净", left, 0)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项: {FAILS}")
    raise SystemExit(1)
print("[通过] 成员主题全部断言通过")
