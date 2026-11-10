"""
上传配额（services/quota.py）的测试。

覆盖：
  · 成员默认配额 = 30，管理员不限（0）
  · 上传真的会记进 upload_logs，monthly_usage 跟着涨
  · 达到上限 → 429（不是 403）
  · 配额设成 0 → 不限
  · 上个月的上传不算进本月
  · 写一个成员只能看到自己的用量

为什么单独测这个：配额是"软限制"，写错了不会报错，
只会静默地让成员无限上传（或者相反，谁都传不了）。

用法：python scripts/test_quota.py --allow-production-db
"""
import io
import struct
import sys
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete, text  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from test_guard import guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession, UploadLog  # noqa: E402
from app.models.admin import DEFAULT_MEMBER_UPLOAD_QUOTA  # noqa: E402
from app.services.quota import (  # noqa: E402
    effective_quota,
    ensure_upload_quota,
    monthly_usage,
    record_upload,
)

guard("test_quota.py")
init_db()

client = TestClient(app)
FAILS: list[str] = []
PFX = "__qt_"


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}: {got!r}" + ("" if ok else f" (期望 {want!r})"))
    if not ok:
        FAILS.append(label)


def check_true(label, cond):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(label)


def make_png(width=8, height=8) -> bytes:
    """最小合法 PNG（避免依赖外部测试图）。"""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def login(admin_id: int) -> None:
    """直接写一条会话记录，跳过登录流程（和 test_review 一致）。

    这样不必关心密码策略、失败计数、IP 限速这些和配额无关的东西。
    """
    from datetime import datetime, timedelta, timezone

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


def upload_one() -> int:
    """传一张图，返回状态码。"""
    r = client.post(
        "/api/upload/image",
        files={"file": ("t.png", io.BytesIO(make_png()), "image/png")},
    )
    return r.status_code


def purge_stale() -> None:
    """清掉上次跑失败时可能残留的测试账号（否则重跑会 409）。"""
    with engine.connect() as c:
        ids = [
            r[0]
            for r in c.execute(
                text("SELECT id FROM admin WHERE username LIKE :p"), {"p": PFX + "%"}
            ).fetchall()
        ]
    for i in ids:
        with engine.begin() as c:
            for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
                c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": i})
            c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": i})
    if ids:
        print(f"  清理上次残留账号: {ids}")


purge_stale()

# ---------------------------------------------------------------- 准备账号
with Session(engine) as db:
    admins = [r if isinstance(r, Admin) else r[0] for r in db.exec(select(Admin)).all()]
    root = next(a for a in admins if a.role == "admin")

login(root.id)
r = client.post(
    "/api/admin/members",
    json={"username": PFX + "q", "password": "a-strong-password-9", "role": "member"},
)
check("创建测试成员 201", r.status_code, 201)
member_id = r.json()["member"]["id"]
with Session(engine) as db:
    member = db.get(Admin, member_id)

# ---------------------------------------------------------------- 1. 默认值
print("\n=== 1. 默认配额 ===")
check("成员默认配额", DEFAULT_MEMBER_UPLOAD_QUOTA, 30)
check("成员 effective_quota", effective_quota(member), 30)
check("管理员不限（0）", effective_quota(root), 0)

with Session(engine) as db:
    # 清掉这个账号的历史上传记录，从 0 开始
    db.exec(delete(UploadLog).where(UploadLog.admin_id == member_id))
    db.commit()
    check("起始用量为 0", monthly_usage(db, member_id), 0)

# ---------------------------------------------------------------- 2. 上传计数
print("\n=== 2. 上传会记进 upload_logs ===")
login(member_id)
code = upload_one()
check("成员上传第 1 张", code, 200)
with Session(engine) as db:
    check("用量变成 1", monthly_usage(db, member_id), 1)

# ---------------------------------------------------------------- 3. 配额用尽
print("\n=== 3. 配额设成 2 → 第 3 张 429 ===")
login(root.id)
r = client.put(f"/api/admin/members/{member_id}", json={"upload_quota": 2})
check("设置配额 200", r.status_code, 200)

login(member_id)
check("第 2 张", upload_one(), 200)
check("第 3 张被拒（429）", upload_one(), 429)

with Session(engine) as db:
    check("用量停在 2", monthly_usage(db, member_id), 2)

# ---------------------------------------------------------------- 4. 0 = 不限
print("\n=== 4. 配额设成 0 → 不限 ===")
login(root.id)
client.put(f"/api/admin/members/{member_id}", json={"upload_quota": 0})
with Session(engine) as db:
    fresh = db.get(Admin, member_id)
check("effective_quota 为 0", effective_quota(fresh), 0)

login(member_id)
check("配额 0 时能继续传", upload_one(), 200)

# ---------------------------------------------------------------- 5. 按月统计
print("\n=== 5. 上个月的上传不算进本月 ===")
with Session(engine) as db:
    before = monthly_usage(db, member_id)
    # SQLModel 对 tz-aware 的 datetime 有校验：必须带时区，否则插入报错
    old = datetime.now(timezone.utc) - timedelta(days=40)
    db.add(
        UploadLog(
            admin_id=member_id,
            kind="image",
            filename="old.png",
            size=100,
            created_at=old,
        )
    )
    db.commit()
    after = monthly_usage(db, member_id)
check("加了上月记录后用量不变", after, before)

# ---------------------------------------------------------------- 6. 越权
print("\n=== 6. 成员不能改别人的配额 ===")
login(member_id)
r = client.put(f"/api/admin/members/{member_id}", json={"upload_quota": 999})
check_true("成员改配额被拒（401/403）", r.status_code in (401, 403))

r = client.get("/api/admin/members")
check_true("成员看不到成员管理（401/403）", r.status_code in (401, 403))

# ---------------------------------------------------------------- 收尾
client.cookies.clear()
with Session(engine) as db:
    db.exec(delete(UploadLog).where(UploadLog.admin_id == member_id))
    db.exec(delete(AdminSession).where(AdminSession.admin_id == member_id))
    db.commit()
with engine.begin() as conn:
    conn.execute(text("DELETE FROM admin WHERE id = :i"), {"i": member_id})

with Session(engine) as db:
    left = db.exec(select(UploadLog).where(UploadLog.admin_id == member_id)).all()
check("清理干净（无残留上传记录）", len(left), 0)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项: {FAILS}")
    raise SystemExit(1)
print("[通过] 上传配额全部断言通过")
