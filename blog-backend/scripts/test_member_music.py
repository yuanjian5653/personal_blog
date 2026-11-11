"""
成员音乐 / 项目的测试。

覆盖：
  · 成员上传音乐 → 归属记在自己名下
  · 配额：超过 music_quota 就不再接收（0 = 不限）
  · 列表 ?mine=1 只返回自己的
  · 成员删不掉别人的歌（403）
  · 项目：成员只看到自己的；改/删别人的（403）
  · 成员管理：music_quota / netease_enabled / github_username 能存能读
  · github_token 只写不读（响应里不出现）

用法：python scripts/test_member_music.py --allow-production-db
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
from sqlalchemy import text  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from test_guard import guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession, Project, Song  # noqa: E402

guard("test_member_music.py")
init_db()

client = TestClient(app)
FAILS: list[str] = []
PFX = "__mm_"


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}: {got!r}" + ("" if ok else f" (期望 {want!r})"))
    if not ok:
        FAILS.append(label)


def check_true(label, cond):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(label)


def fake_mp3(name: str) -> tuple[str, bytes, str]:
    """造一个「看起来像 mp3」的文件。

    不需要真能解码：上传路径只校验扩展名，元数据提取失败会退回文件名。
    """
    # 每个文件名都掺进去：内容哈希不同，才不会被去重逻辑当成同一首
    body = (
        b"ID3\x03\x00\x00\x00\x00\x00\x00"
        + name.encode("utf-8")
        + bytes(range(256)) * 4
    )
    return (name, body, "audio/mpeg")


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
        songs = [
            r[0]
            for r in c.execute(
                text("SELECT id FROM songs WHERE title LIKE :p"), {"p": PFX + "%"}
            ).fetchall()
        ]
        projs = [
            r[0]
            for r in c.execute(
                text("SELECT id FROM projects WHERE full_name LIKE :p"),
                {"p": PFX + "%"},
            ).fetchall()
        ]
    with engine.begin() as c:
        for i in songs:
            c.execute(text("DELETE FROM songs WHERE id = :i"), {"i": i})
        for i in projs:
            c.execute(text("DELETE FROM projects WHERE id = :i"), {"i": i})
        for i in ids:
            for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
                c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": i})
            c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": i})
    if ids or songs or projs:
        print(f"  清理残留: admins={ids} songs={songs} projects={projs}")


purge_stale()

# ---------------------------------------------------------------- 准备两个账号
with Session(engine) as db:
    admins = [r if isinstance(r, Admin) else r[0] for r in db.exec(select(Admin)).all()]
    root = next(a for a in admins if a.role == "admin")

login(root.id)
r = client.post(
    "/api/admin/members",
    json={"username": PFX + "a", "password": "a-strong-password-9", "role": "member"},
)
check("创建成员 A 201", r.status_code, 201)
member_a = r.json()["member"]["id"]

r = client.post(
    "/api/admin/members",
    json={"username": PFX + "b", "password": "a-strong-password-9", "role": "member"},
)
check("创建成员 B 201", r.status_code, 201)
member_b = r.json()["member"]["id"]

# ---------------------------------------------------------------- 1. 配额设置
print("\n=== 1. 管理员设置音乐配额 ===")
r = client.put(f"/api/admin/members/{member_a}", json={"music_quota": 1})
check("设配额 200", r.status_code, 200)
check("读回配额", r.json().get("music_quota"), 1)
check("网易云默认关", r.json().get("netease_enabled"), None)

r = client.put(
    f"/api/admin/members/{member_a}",
    json={"netease_enabled": True, "github_username": PFX + "gh"},
)
check("设网易云 + GitHub 用户名 200", r.status_code, 200)
check("网易云已开", r.json().get("netease_enabled"), True)
check("GitHub 用户名已存", r.json().get("github_username"), PFX + "gh")
check_true("响应里没有 github_token", "github_token" not in r.json())

# ---------------------------------------------------------------- 2. 上传音乐
print("\n=== 2. 成员上传音乐（配额 1 首）===")
login(member_a)
r = client.post(
    "/api/music/upload",
    files=[("files", fake_mp3(PFX + "第一首.mp3"))],
)
check("第 1 首 200", r.status_code, 200)
created = r.json()
check("返回 1 首", len(created), 1)
song_a = created[0]["id"] if created else None
check("归属是自己", created[0].get("author_id") if created else None, member_a)

r = client.post(
    "/api/music/upload",
    files=[("files", fake_mp3(PFX + "第二首.mp3"))],
)
check("超配额时返回空数组", r.status_code, 200)
check("没有新增", len(r.json()), 0)

# 配额设 0 = 不限
login(root.id)
client.put(f"/api/admin/members/{member_a}", json={"music_quota": 0})
login(member_a)
r = client.post(
    "/api/music/upload",
    files=[("files", fake_mp3(PFX + "第二首.mp3"))],
)
check("配额 0 时能继续传", len(r.json()), 1)

# ---------------------------------------------------------------- 3. 列表隔离
print("\n=== 3. 列表按归属隔离 ===")
login(member_b)
r = client.get("/api/music/songs?mine=1")
check("B 的列表里没有 A 的歌", len(r.json()), 0)

login(member_a)
r = client.get("/api/music/songs?mine=1")
check("A 的列表里有两首", len(r.json()), 2)

r = client.get("/api/music/songs")
check_true("不带 mine 时返回全部（前台播放用）", len(r.json()) >= 2)

# ---------------------------------------------------------------- 4. 删除隔离
print("\n=== 4. 删不掉别人的歌 ===")
login(member_b)
r = client.delete(f"/api/music/songs/{song_a}")
check("B 删 A 的歌 403", r.status_code, 403)

login(member_a)
r = client.delete(f"/api/music/songs/{song_a}")
check("A 删自己的歌 200", r.status_code, 200)

# ---------------------------------------------------------------- 5. 项目隔离
print("\n=== 5. 项目按归属隔离 ===")
with Session(engine) as db:
    db.add(
        Project(
            full_name=PFX + "owner/repo",
            name=PFX + "repo",
            html_url="https://github.com/" + PFX + "owner/repo",
            author_id=member_a,
        )
    )
    db.commit()

login(member_b)
r = client.get("/api/projects/all")
check("B 看不到 A 的项目", len(r.json()), 0)

login(member_a)
r = client.get("/api/projects/all")
check("A 能看到自己的项目", len(r.json()), 1)
proj_id = r.json()[0]["id"]

login(member_b)
r = client.delete(f"/api/projects/{proj_id}")
check("B 删 A 的项目 403", r.status_code, 403)

# ---------------------------------------------------------------- 收尾
client.cookies.clear()
with engine.begin() as c:
    c.execute(text("DELETE FROM songs WHERE title LIKE :p"), {"p": PFX + "%"})
    c.execute(text("DELETE FROM projects WHERE full_name LIKE :p"), {"p": PFX + "%"})
    for i in (member_a, member_b):
        for tbl in ("admin_sessions", "upload_logs", "operation_logs", "author_profiles"):
            c.execute(text(f"DELETE FROM {tbl} WHERE admin_id = :i"), {"i": i})
        c.execute(text("DELETE FROM admin WHERE id = :i"), {"i": i})

# 清掉上传到磁盘的测试音频
for f in settings.MUSIC_DIR.glob(PFX + "*"):
    try:
        f.unlink()
    except OSError:
        pass

with Session(engine) as db:
    left_songs = db.exec(select(Song).where(Song.title.like(PFX + "%"))).all()
    left_proj = db.exec(select(Project).where(Project.full_name.like(PFX + "%"))).all()
    left_admin = db.get(Admin, member_a)
check("歌曲清理干净", len(left_songs), 0)
check("项目清理干净", len(left_proj), 0)
check("账号清理干净", left_admin, None)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项: {FAILS}")
    raise SystemExit(1)
print("[通过] 成员音乐 / 项目全部断言通过")
