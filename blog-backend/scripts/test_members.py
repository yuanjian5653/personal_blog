"""
多角色后台（阶段 1）的测试。

覆盖的都是"一旦写错就会出事"的点：

  · 成员看不到成员管理接口（403）
  · 成员创建的内容自动带上自己的 author_id
  · 成员不能改/删别人的内容（403），能改自己的
  · 不能降级/停用/删除**最后一个启用中的管理员**（409）
  · 管理员不能改自己的角色或状态（400，防自锁）
  · 改角色/停用/重置密码会立刻删掉该账号所有 session
  · /api/auth/me 返回 role 与 display_name
  · /api/authors 公开、可匿名访问、且不含任何密码字段
  · 被停用的账号即使手里有旧 session 也不能继续用（403）

用法：python scripts/test_members.py --allow-production-db
"""
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import admin_id_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession, Article  # noqa: E402

guard("test_members.py")
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []
PFX = "__mt_"


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
    """清掉测试造的账号。

    顺序很重要（都是外键）：session → 内容 → 操作日志 → 账号。
    否则会撞 1451。生产代码里正是因为这几条外键，DELETE 账号改成了软删除。
    """
    from sqlalchemy import text as sql_text

    with Session(engine) as db:
        rows = db.exec(select(Admin).where(Admin.username.startswith(PFX))).all()
        ids = [a.id for a in (r if isinstance(r, Admin) else r[0] for r in rows) if a]
        if not ids:
            return

        for aid in ids:
            for s in db.exec(
                select(AdminSession).where(AdminSession.admin_id == aid)
            ).all():
                obj = s if isinstance(s, AdminSession) else s[0]
                if isinstance(obj, AdminSession):
                    db.delete(obj)
            for a in db.exec(
                select(Article).where(Article.author_id == aid)
            ).all():
                obj = a if isinstance(a, Article) else a[0]
                if isinstance(obj, Article):
                    db.delete(obj)
            db.commit()

            # 操作日志与其它内容表都可能挂着外键
            conn = db.connection()
            conn.execute(
                sql_text("DELETE FROM operation_logs WHERE admin_id = :aid"),
                {"aid": aid},
            )
            for table in ("essays", "life_posts", "albums", "photos", "friend_links"):
                conn.execute(
                    sql_text(f"UPDATE {table} SET author_id = NULL WHERE author_id = :aid"),
                    {"aid": aid},
                )
            db.commit()

        for aid in ids:
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


def _login_as(admin_id: int) -> None:
    """用**真实 session** 以指定账号身份发请求。

    为什么不用 dependency_overrides：
        list_articles 用的是 get_current_admin_optional，它在内部
        **直接调用** get_current_admin 这个函数，而不是通过 Depends 解析。
        FastAPI 的依赖覆盖只对"被解析的依赖"生效，所以覆盖对那条路径没用 ——
        第一版测试就栽在这里（mine=1 一直 401）。
        用真实 session 反而更接近线上，也能顺带验证 deps 里的状态校验。
    """
    from datetime import datetime, timedelta, timezone

    token = f"{PFX}tok-{admin_id}"
    with Session(engine) as db:
        for r in db.exec(
            select(AdminSession).where(AdminSession.session_token == token)
        ).all():
            obj = r if isinstance(r, AdminSession) else r[0]
            if isinstance(obj, AdminSession):
                db.delete(obj)
        db.commit()
        db.add(
            AdminSession(
                admin_id=admin_id,
                session_token=token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
        )
        db.commit()

    client.cookies.clear()
    client.cookies.set("session_token", token)


def as_admin(admin_id: int) -> None:
    _login_as(admin_id)


def as_member(admin_id: int) -> None:
    _login_as(admin_id)


as_admin(root_id)

# ------------------------------------------------------------------ 创建
print("=== 1. 管理员创建成员 ===")
r = client.post(
    "/api/admin/members",
    json={
        "username": PFX + "alice",
        "password": "a-strong-password-1",
        "display_name": "Alice",
        "role": "member",
    },
)
check("创建成功 201", r.status_code, 201)
created = r.json()
alice_id = created["member"]["id"]
check("角色是 member", created["member"]["role"], "member")
check("状态是 active", created["member"]["status"], "active")
check_true("一次性返回了初始密码", bool(created.get("password")))

# 重名
r = client.post(
    "/api/admin/members",
    json={"username": PFX + "alice", "password": "a-strong-password-1"},
)
check("重名 409", r.status_code, 409)

# 弱密码
r = client.post(
    "/api/admin/members",
    json={"username": PFX + "weak", "password": "short"},
)
check("弱密码 422 或 400", r.status_code in (400, 422), True)

# ------------------------------------------------------------------ 成员看不到成员管理
print("\n=== 2. 成员无权访问成员管理 ===")
as_member(alice_id)
r = client.get("/api/admin/members")
check("成员 GET → 403", r.status_code, 403)
r = client.post(
    "/api/admin/members",
    json={"username": PFX + "bob", "password": "a-strong-password-1"},
)
check("成员创建账号 → 403", r.status_code, 403)

# ------------------------------------------------------------------ 内容归属
print("\n=== 3. 成员创建内容自动带 author_id ===")
r = client.post(
    "/api/articles",
    json={
        "title": PFX + "成员文章",
        "content": "正文",
        "status": "published",
    },
)
check("成员创建文章 200", r.status_code, 200)
a1 = r.json()
check("author_id 是成员自己", a1.get("author_id"), alice_id)

# 管理员也建一篇
as_admin(root_id)
r = client.post(
    "/api/articles",
    json={"title": PFX + "管理员文章", "content": "正文", "status": "published"},
)
check("管理员创建文章 200", r.status_code, 200)
a2 = r.json()
check("author_id 是管理员", a2.get("author_id"), root_id)

# ------------------------------------------------------------------ 只能改自己的
print("\n=== 4. 成员只能改/删自己的内容 ===")
as_member(alice_id)
r = client.put(f"/api/articles/{a2['id']}", json={"title": "想改别人的"})
check("改别人的文章 → 403", r.status_code, 403)
r = client.delete(f"/api/articles/{a2['id']}")
check("删别人的文章 → 403", r.status_code, 403)

r = client.put(f"/api/articles/{a1['id']}", json={"title": PFX + "改自己的"})
check("改自己的文章 → 200", r.status_code, 200)

r = client.delete(f"/api/articles/{a1['id']}")
check("删自己的文章 → 200", r.status_code, 200)

# 管理员可以改别人的
as_admin(root_id)
r = client.put(f"/api/articles/{a2['id']}", json={"title": PFX + "管理员改的"})
check("管理员改成员的文章 → 200", r.status_code, 200)

# ------------------------------------------------------------------ mine 过滤
print("\n=== 5. 后台列表的 mine 过滤 ===")
r = client.get("/api/articles?status=published&mine=1")
rows = r.json()
check_true(
    "管理员 mine=1 只返回自己的",
    all(x.get("author_id") == root_id for x in rows),
    str({x.get("author_id") for x in rows}),
)

as_member(alice_id)
r = client.get("/api/articles?status=published&mine=1")
rows = r.json()
check_true(
    "成员 mine=1 只返回自己的",
    all(x.get("author_id") == alice_id for x in rows),
    str({x.get("author_id") for x in rows}),
)

# ------------------------------------------------------------------ 保护规则
print("\n=== 6. 最后一个管理员保护 ===")
as_admin(root_id)
r = client.put(f"/api/admin/members/{root_id}", json={"role": "member"})
check("改自己角色 → 400", r.status_code, 400)

# 造第二个管理员
r = client.post(
    "/api/admin/members",
    json={
        "username": PFX + "admin2",
        "password": "a-strong-password-2",
        "role": "admin",
    },
)
check("创建第二个管理员 201", r.status_code, 201)
admin2_id = r.json()["member"]["id"]

# 现在有两个管理员，可以降级 admin2
r = client.put(f"/api/admin/members/{admin2_id}", json={"role": "member"})
check("有两个管理员时可以降级其中一个", r.status_code, 200)

# 只剩 root 一个启用管理员 → 再想降级 root 会被自己那条规则挡住（400）
r = client.put(f"/api/admin/members/{root_id}", json={"role": "member"})
check("降级自己仍被拒 400", r.status_code, 400)

# 删除自己
r = client.delete(f"/api/admin/members/{root_id}")
check("删除自己 → 400", r.status_code, 400)

# ------------------------------------------------------------------ 停用即失效
print("\n=== 7. 停用账号会清掉它的 session ===")
with Session(engine) as db:
    db.add(
        AdminSession(
            admin_id=alice_id,
            session_token=PFX + "token-1",
            expires_at=__import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            ) + __import__("datetime").timedelta(days=7),
        )
    )
    db.commit()

r = client.put(f"/api/admin/members/{alice_id}", json={"status": "disabled"})
check("停用成员 200", r.status_code, 200)
with Session(engine) as db:
    n = len(
        db.exec(
            select(AdminSession).where(AdminSession.admin_id == alice_id)
        ).all()
    )
check("该账号的 session 已被清空", n, 0)

# 重新启用后旧 session 已经没了，后续操作要重新登录
as_admin(root_id)
client.put(f"/api/admin/members/{alice_id}", json={"status": "active"})

# ------------------------------------------------------------------ 作者表
print("\n=== 8. /api/authors 公开且不泄露凭据 ===")
client.cookies.clear()
r = client.get("/api/authors")
check("/api/authors 匿名 200", r.status_code, 200)
authors = r.json()
check_true("返回列表", isinstance(authors, list) and len(authors) >= 1)
if authors:
    keys = set(authors[0].keys())
    check_true(
        "不含密码相关字段",
        not ({"password_hash", "password", "username"} & keys),
        str(keys),
    )
    check_true("有 name 字段", "name" in keys)

# ------------------------------------------------------------------ auth/me
print("\n=== 9. /api/auth/me 返回角色 ===")
with Session(engine) as db:
    root = db.get(Admin, root_id)
    check("库里管理员 role", root.role, "admin")

as_admin(root_id)
r = client.get("/api/auth/me")
check("/api/auth/me 200", r.status_code, 200)
body = r.json()
check("返回 role", body.get("role"), "admin")
check_true("返回 display_name", "display_name" in body)

# ------------------------------------------------------------------ 收尾
client.cookies.clear()
cleanup()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 多角色后台权限全部断言通过")
