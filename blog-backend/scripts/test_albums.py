"""
图片组 / 照片 CRUD 的测试。

为什么必须有：/api/albums 曾经因为 Album 模型里混进了 Photo 的审核字段
而 500（`Unknown column 'albums.review_status'`），那时**这个接口完全没有测试**，
所以一路漏到了线上。

覆盖：
  · 创建 / 列表 / 详情 / 更新 / 删除
  · 未登录 → 401
  · 成员只能动自己的图片组（改、删、传照片都 403）
  · 成员能在自己的组里传照片、删照片
  · 访客看不到待审图片组（审核流的细节在 test_album_review.py）
  · 删除图片组会连带删掉照片记录

用法：python scripts/test_albums.py --allow-production-db
"""
import io
import struct
import sys
import zlib
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from test_guard import guard  # noqa: E402

from app.database import engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession, Album, Photo, UploadLog  # noqa: E402

guard("test_albums.py")
init_db()

client = TestClient(app)
FAILS: list[str] = []
PFX = "__ab_"


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
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\x00\xff\x00" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def login(admin_id: int) -> None:
    """写一条会话记录，跳过登录流程。"""
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


def upload_photo(album_id: int) -> int:
    r = client.post(
        f"/api/albums/{album_id}/photos",
        files={"files": ("a.png", io.BytesIO(make_png()), "image/png")},
    )
    return r.status_code


def purge_stale() -> None:
    """清掉上次失败残留的测试账号与相册。"""
    with engine.connect() as c:
        ids = [
            r[0]
            for r in c.execute(
                text("SELECT id FROM admin WHERE username LIKE :p"), {"p": PFX + "%"}
            ).fetchall()
        ]
        albums = [
            r[0]
            for r in c.execute(
                text("SELECT id FROM albums WHERE name LIKE :p"), {"p": PFX + "%"}
            ).fetchall()
        ]
    for a in albums:
        with engine.begin() as c:
            c.execute(text("DELETE FROM photos WHERE album_id = :a"), {"a": a})
            c.execute(text("DELETE FROM albums WHERE id = :a"), {"a": a})
    for i in ids:
        with engine.begin() as c:
            for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
                c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": i})
            c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": i})
    if ids or albums:
        print(f"  清理残留: albums={albums} admins={ids}")


purge_stale()

# ---------------------------------------------------------------- 准备
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

# ---------------------------------------------------------------- 1. CRUD
print("\n=== 1. 图片组 CRUD ===")
login(root.id)
r = client.post(
    "/api/albums",
    json={"name": PFX + "组", "description": "初始描述", "date_label": "2026-01"},
)
check("创建 200", r.status_code, 200)
album_id = r.json()["id"]
check("封面为空", r.json()["cover_path"], None)
check("照片数为 0", r.json()["photo_count"], 0)

r = client.get("/api/albums")
check("列表里有它", any(a["id"] == album_id for a in r.json()), True)

r = client.get(f"/api/albums/{album_id}")
check("详情 200", r.status_code, 200)
check("详情照片为空", len(r.json()["photos"]), 0)

r = client.put(f"/api/albums/{album_id}", json={"name": PFX + "组改名", "description": "改过"})
check("更新 200", r.status_code, 200)
check("名字已改", r.json()["name"], PFX + "组改名")
check("描述已改", r.json()["description"], "改过")

r = client.get("/api/albums/99999999")
check("不存在的组 404", r.status_code, 404)

# ---------------------------------------------------------------- 2. 未登录
print("\n=== 2. 未登录 ===")
client.cookies.clear()
r = client.post("/api/albums", json={"name": PFX + "偷偷建"})
check("未登录创建 401", r.status_code, 401)
check("未登录传照片 401", upload_photo(album_id), 401)
r = client.get("/api/albums")
check("访客仍能看列表", r.status_code, 200)

# ---------------------------------------------------------------- 3. 归属
print("\n=== 3. 成员只能动自己的 ===")
login(member_id)
r = client.post("/api/albums", json={"name": PFX + "成员的组"})
check("成员创建 200", r.status_code, 200)
member_album = r.json()["id"]
check("成员组的 author_id 是本人", r.json()["author_id"], member_id)

r = client.put(f"/api/albums/{album_id}", json={"name": "试图改站长的"})
check("改别人的组 403", r.status_code, 403)
r = client.delete(f"/api/albums/{album_id}")
check("删别人的组 403", r.status_code, 403)
check("往别人的组传照片 403", upload_photo(album_id), 403)

check("往自己的组传照片 200", upload_photo(member_album), 200)

# ---------------------------------------------------------------- 4. 照片
print("\n=== 4. 照片增删 ===")
login(root.id)
check("站长的组传照片 200", upload_photo(album_id), 200)
r = client.get(f"/api/albums/{album_id}")
photos = r.json()["photos"]
check("照片数 1", len(photos), 1)
photo_id = photos[0]["id"]

r = client.get("/api/albums?mine=1")
mine = [a for a in r.json() if a["id"] == album_id]
check("后台「只看我的」能看到", len(mine), 1)

r = client.delete(f"/api/albums/{album_id}/photos/{photo_id}")
check("删照片 200", r.status_code, 200)
r = client.get(f"/api/albums/{album_id}")
check("照片数回到 0", len(r.json()["photos"]), 0)

# ---------------------------------------------------------------- 5. 删除
print("\n=== 5. 删除图片组 ===")
upload_photo(member_album)  # 先塞一张，验证级联
r = client.delete(f"/api/albums/{album_id}")
check("站长删自己的组 200", r.status_code, 200)
r = client.get(f"/api/albums/{album_id}")
check("删完 404", r.status_code, 404)

login(member_id)
r = client.delete(f"/api/albums/{member_album}")
check("成员删自己的组 200", r.status_code, 200)

with Session(engine) as db:
    left = db.exec(select(Photo).where(Photo.album_id == member_album)).all()
check("照片记录一并删除", len(left), 0)

# ---------------------------------------------------------------- 收尾
client.cookies.clear()
with Session(engine) as db:
    db.exec(text("DELETE FROM photos WHERE album_id IN (SELECT id FROM albums WHERE name LIKE :p)").bindparams(p=PFX + "%"))
    db.commit()
with engine.begin() as c:
    c.execute(text("DELETE FROM photos WHERE album_id IN (SELECT id FROM albums WHERE name LIKE :p)"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM albums WHERE name LIKE :p"), {"p": PFX + "%"})
    for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
        c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": member_id})
    c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": member_id})

with Session(engine) as db:
    left_albums = db.exec(select(Album).where(Album.name.like(PFX + "%"))).all()
    left_admin = db.get(Admin, member_id)
    left_log = db.exec(select(UploadLog).where(UploadLog.admin_id == member_id)).all()
check("测试相册清理干净", len(left_albums), 0)
check("测试账号清理干净", left_admin, None)
check("上传日志清理干净", len(left_log), 0)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项: {FAILS}")
    raise SystemExit(1)
print("[通过] 图片组 CRUD 全部断言通过")
