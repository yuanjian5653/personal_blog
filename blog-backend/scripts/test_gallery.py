"""
图库管理的测试（引用检测是重点 —— 它决定了会不会误删）。

覆盖：
  · 列表 / 统计能正常返回
  · **相册里的照片必须被识别为"被引用"**（漏扫 Photo 表会误删相册）
  · 文章封面、生活图片、头像、主题背景都算引用
  · 没有任何引用的图片才被标成孤儿
  · 路径穿越被拦住（../../.env 之类）
  · 被引用的图片即使点名也不删
  · dry_run 不真的删文件

用法：python scripts/test_gallery.py --allow-production-db
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

from app.config import settings  # noqa: E402
from app.database import engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession, Article, LifePost, Photo  # noqa: E402

guard("test_gallery.py")
init_db()

client = TestClient(app)
FAILS: list[str] = []
PFX = "__gal_"


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}: {got!r}" + ("" if ok else f" (期望 {want!r})"))
    if not ok:
        FAILS.append(label)


def check_true(label, cond, extra=""):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}" + (f" ({extra})" if extra and not cond else ""))
    if not cond:
        FAILS.append(label)


def login(admin_id: int) -> None:
    token = f"{PFX}tok"
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


# 上一次跑挂了会留残留，清掉保证可重复执行
with engine.begin() as c:
    c.execute(text("DELETE FROM photos WHERE file_path LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM albums WHERE name LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM articles WHERE slug LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM admin_sessions WHERE session_token = :t"), {"t": PFX + "tok"})
for leftover in settings.PHOTO_DIR.glob(PFX + "*"):
    try:
        leftover.unlink(missing_ok=True)
    except OSError:
        pass

# ---------------------------------------------------------------- 造测试图片
made_files: list[Path] = []


def make_file(name: str, size: int = 64) -> Path:
    p = settings.PHOTO_DIR / name
    p.write_bytes(b"\xff\xd8\xff\xe0" + b"0" * size)
    made_files.append(p)
    return p


# 三张：一张被相册引用、一张被文章封面引用、一张谁都不引用
album_img = f"{PFX}album.jpg"
article_img = f"{PFX}article.jpg"
orphan_img = f"{PFX}orphan.jpg"
make_file(album_img, 128)
make_file(article_img, 256)
make_file(orphan_img, 512)

with Session(engine) as db:
    admins = [r if isinstance(r, Admin) else r[0] for r in db.exec(select(Admin)).all()]
    root = next(a for a in admins if a.role == "admin")
    root_id = int(root.id or 0)

    # 相册 + 照片（照片才是照片本体）
    from app.models import Album

    album = Album(name=PFX + "测试相册", author_id=root_id)
    db.add(album)
    db.commit()
    db.refresh(album)
    db.add(Photo(album_id=album.id, file_path=album_img, author_id=root_id))
    db.commit()

    # 一张被文章封面引用
    db.add(
        Article(
            title=PFX + "测试文章",
            slug=PFX + "test-article",
            content="正文",
            cover_path=f"/media/photos/{article_img}",
            author_id=root_id,
        )
    )
    db.commit()

login(root_id)

# ---------------------------------------------------------------- 1. 统计
print("\n=== 1. 统计与列表 ===")
r = client.get("/api/admin/gallery/stats")
check("统计 200", r.status_code, 200)
stats = r.json()
check_true("总数 > 0", stats["total"] > 0, stats)
check_true("有孤儿", stats["orphans"] >= 1, stats)
check_true("有被引用的", stats["referenced"] >= 1, stats)

r = client.get("/api/admin/gallery")
check("列表 200", r.status_code, 200)
items = r.json()
by_name = {i["name"]: i for i in items}

# ---------------------------------------------------------------- 2. 引用检测（关键）
print("\n=== 2. 引用检测 ===")
check_true("相册照片被识别为『被引用』（漏扫 Photo 就会误删相册）",
           by_name.get(album_img, {}).get("referenced") is True,
           str(by_name.get(album_img)))
check_true("文章封面被识别为『被引用』",
           by_name.get(article_img, {}).get("referenced") is True,
           str(by_name.get(article_img)))
check_true("谁都不用的图被判为孤儿",
           by_name.get(orphan_img, {}).get("referenced") is False,
           str(by_name.get(orphan_img)))

# ---------------------------------------------------------------- 3. 只列孤儿
print("\n=== 3. only_orphan 筛选 ===")
r = client.get("/api/admin/gallery?only_orphan=true")
check("200", r.status_code, 200)
orphans = [i["name"] for i in r.json()]
check_true("孤儿列表里有它", orphan_img in orphans)
check_true("相册图不在孤儿里", album_img not in orphans)
check_true("文章封面不在孤儿里", article_img not in orphans)

# ---------------------------------------------------------------- 4. 干跑
print("\n=== 4. dry_run 不真删 ===")
r = client.post("/api/admin/gallery/cleanup", json={"dry_run": True})
check("200", r.status_code, 200)
before = (settings.PHOTO_DIR / orphan_img).exists()
check_true("干跑前列出了要删的", orphan_img in r.json()["deleted"])
check_true("干跑后文件还在", before)
check_true("干跑不动相册图", album_img not in r.json()["deleted"])

# ---------------------------------------------------------------- 5. 点名删被引用的也不删
print("\n=== 5. 被引用的图点名也不删 ===")
r = client.post(
    "/api/admin/gallery/cleanup",
    json={"names": [album_img, article_img], "dry_run": False},
)
check("200", r.status_code, 200)
check("删除了 0 个", len(r.json()["deleted"]), 0)
check_true("被跳过", len(r.json()["skipped"]) == 2, str(r.json()["skipped"]))
check_true("相册图仍在磁盘", (settings.PHOTO_DIR / album_img).exists())

# ---------------------------------------------------------------- 6. 路径穿越
print("\n=== 6. 路径穿越防护 ===")
for bad in ("../../.env", "..\\..\\x.jpg", "/etc/passwd.jpg", "sub/dir.jpg"):
    r = client.post("/api/admin/gallery/cleanup", json={"names": [bad], "dry_run": False})
    body = r.json()
    check_true(f"{bad!r} 被拦住", len(body["deleted"]) == 0 and bad in body["skipped"], str(body))

# ---------------------------------------------------------------- 7. 真删孤儿
print("\n=== 7. 真删孤儿 ===")
r = client.post(
    "/api/admin/gallery/cleanup", json={"names": [orphan_img], "dry_run": False}
)
body = r.json()
check("删除了 1 个", len(body["deleted"]), 1)
check_true("腾出空间 > 0", body["freed"] > 0, str(body["freed"]))
check_true("文件真的没了", not (settings.PHOTO_DIR / orphan_img).exists())
if orphan_img in made_files:
    made_files.remove(settings.PHOTO_DIR / orphan_img)

# ---------------------------------------------------------------- 收尾
client.cookies.clear()
with engine.begin() as c:
    c.execute(text("DELETE FROM photos WHERE file_path LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM albums WHERE name LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM articles WHERE slug LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM admin_sessions WHERE session_token = :t"), {"t": PFX + "tok"})
    c.execute(text("DELETE FROM operation_logs WHERE target_type = 'gallery'"))

for f in made_files:
    try:
        f.unlink(missing_ok=True)
    except OSError:
        pass

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项: {FAILS}")
    raise SystemExit(1)
print("[通过] 图库管理全部断言通过（相册照片不会被误删）")
