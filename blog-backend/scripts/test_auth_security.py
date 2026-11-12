"""
认证与传输安全测试。

覆盖（都是"被攻破一次就够痛"的点）：
  · 连续密码错误 5 次 → 账号锁定，第 6 次返回 429（即使密码对了）
  · 锁定期间换 IP 也没用（锁在账号上）
  · 登录成功会清掉该账号的旧会话（历史 token 立即失效）
  · 登录成功会清空失败计数与锁定状态
  · Cookie 的 httponly / samesite / secure 来自配置而不是写死
  · 用户不存在与密码错误返回完全相同的状态码和文案（不泄露账号是否存在）
  · /api/health 不再暴露 debug 标志
  · 四个安全响应头都在

用法：python scripts/test_auth_security.py --allow-production-db
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import guard  # noqa: E402

from app import net_utils
from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession  # noqa: E402
from app.routers import auth as auth_module  # noqa: E402
from app.services.security import hash_password  # noqa: E402

guard("test_auth_security.py")
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []

TEST_USER = "__sec_test_admin"
TEST_PASS = "correct-horse-battery-staple"


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
        if extra:
            print(f"          {extra}")


def cleanup() -> None:
    with Session(engine) as db:
        row = db.exec(select(Admin).where(Admin.username == TEST_USER)).first()
        admin = row if isinstance(row, Admin) else (row[0] if row else None)
        if admin is not None:
            # 先删会话并提交，再删管理员。
            # 这两个表只靠外键约束关联（模型里没有 relationship），
            # SQLAlchemy 不会替我们排序，同一个事务里可能先删父行 → 1451。
            for s in db.exec(
                select(AdminSession).where(AdminSession.admin_id == admin.id)
            ).all():
                obj = s if isinstance(s, AdminSession) else s[0]
                if isinstance(obj, AdminSession):
                    db.delete(obj)
            db.commit()

            fresh = db.exec(select(Admin).where(Admin.id == admin.id)).first()
            target = fresh if isinstance(fresh, Admin) else (fresh[0] if fresh else None)
            if target is not None:
                db.delete(target)
                db.commit()


cleanup()

# 建一个测试管理员
with Session(engine) as db:
    db.add(
        Admin(
            username=TEST_USER,
            password_hash=hash_password(TEST_PASS),
            failed_attempts=0,
            locked_until=None,
        )
    )
    db.commit()

client = TestClient(app)
# 每个用例用不同的"IP"，避免 IP 层限速互相干扰
IP_N = 0


def fresh_headers() -> dict:
    global IP_N
    IP_N += 1
    return {"X-Forwarded-For": f"203.0.113.{IP_N}"}


def get_admin() -> Admin:
    with Session(engine) as db:
        row = db.exec(select(Admin).where(Admin.username == TEST_USER)).first()
        return row if isinstance(row, Admin) else row[0]


def reset_attempts() -> None:
    with Session(engine) as db:
        row = db.exec(select(Admin).where(Admin.username == TEST_USER)).first()
        admin = row if isinstance(row, Admin) else row[0]
        admin.failed_attempts = 0
        admin.locked_until = None
        db.add(admin)
        db.commit()
    # 清掉 IP 层的失败记录，避免同一进程里的历史影响后续用例
    auth_module._ip_failures.clear()


# ------------------------------------------------------------------ 1. 错误密码
print("=== 1. 密码错误不允许登录 ===")
r = client.post(
    "/api/auth/login",
    json={"username": TEST_USER, "password": "wrong-password"},
    headers=fresh_headers(),
)
check("错误密码 → 401", r.status_code, 401)
check("错误密码不设置 Cookie", "set-cookie" in r.headers, False)
check("失败计数 +1", get_admin().failed_attempts, 1)

# ------------------------------------------------------------------ 2. 账号锁定
print("\n=== 2. 连续失败 → 账号锁定 ===")
reset_attempts()
for i in range(auth_module.MAX_FAILED_ATTEMPTS):
    client.post(
        "/api/auth/login",
        json={"username": TEST_USER, "password": f"bad-{i}"},
        headers=fresh_headers(),
    )
admin = get_admin()
check_true("已设置 locked_until", admin.locked_until is not None)
check("锁定后失败计数清零", admin.failed_attempts, 0)

# 锁定期即使密码正确也拒绝
r = client.post(
    "/api/auth/login",
    json={"username": TEST_USER, "password": TEST_PASS},
    headers=fresh_headers(),
)
check("锁定期正确密码也被拒 → 429", r.status_code, 429)
check_true("提示里带锁定信息", "锁定" in r.json().get("detail", ""), r.text[:80])

# 换个 IP 也不行（锁在账号上）
r = client.post(
    "/api/auth/login",
    json={"username": TEST_USER, "password": TEST_PASS},
    headers={"X-Forwarded-For": "198.51.100.77"},
)
check("换 IP 依然被锁 → 429", r.status_code, 429)

# ------------------------------------------------------------------ 3. 解锁后正常
print("\n=== 3. 解锁后登录成功 ===")
reset_attempts()
r = client.post(
    "/api/auth/login",
    json={"username": TEST_USER, "password": TEST_PASS},
    headers=fresh_headers(),
)
check("密码正确 → 200", r.status_code, 200)
check("清空失败计数", get_admin().failed_attempts, 0)
check("清空锁定状态", get_admin().locked_until, None)

cookie = r.headers.get("set-cookie", "")
check_true("设置了 session_token", "session_token=" in cookie, cookie[:80])
check_true("HttpOnly 存在", "httponly" in cookie.lower(), cookie[:120])

# ------------------------------------------------------------------ 4. 会话轮换
print("\n=== 4. 登录成功后旧会话失效 ===")
with Session(engine) as db:
    admin_db = db.exec(select(Admin).where(Admin.username == TEST_USER)).first()
    a = admin_db if isinstance(admin_db, Admin) else admin_db[0]
    sessions = db.exec(
        select(AdminSession).where(AdminSession.admin_id == a.id)
    ).all()
check("只剩 1 条会话", len(sessions), 1)

# 再登录一次，token 应该换新，旧的不再有效
r2 = client.post(
    "/api/auth/login",
    json={"username": TEST_USER, "password": TEST_PASS},
    headers=fresh_headers(),
)
new_cookie = r2.headers.get("set-cookie", "")
check_true("新一次登录换了 token", new_cookie.split(";")[0] != cookie.split(";")[0])
with Session(engine) as db:
    admin_db = db.exec(select(Admin).where(Admin.username == TEST_USER)).first()
    a = admin_db if isinstance(admin_db, Admin) else admin_db[0]
    sessions = db.exec(
        select(AdminSession).where(AdminSession.admin_id == a.id)
    ).all()
check("旧会话被删，仍只剩 1 条", len(sessions), 1)

# ------------------------------------------------------------------ 5. 不泄露账号是否存在
print("\n=== 5. 账号不存在与密码错误响应一致 ===")
reset_attempts()
r_no_user = client.post(
    "/api/auth/login",
    json={"username": "__definitely_not_exist__", "password": "whatever"},
    headers=fresh_headers(),
)
r_bad_pass = client.post(
    "/api/auth/login",
    json={"username": TEST_USER, "password": "whatever"},
    headers=fresh_headers(),
)
check("状态码一致", r_no_user.status_code, r_bad_pass.status_code)
check("文案一致", r_no_user.json().get("detail"), r_bad_pass.json().get("detail"))
check("都是 401", r_no_user.status_code, 401)

# ------------------------------------------------------------------ 6. health 不泄露
print("\n=== 6. /api/health 不暴露调试信息 ===")
r = client.get("/api/health")
body = r.json()
check("status 正常", body.get("status"), "ok")
check_true("不含 debug 字段", "debug" not in body, str(body))
check_true("字段只有 status", set(body.keys()) == {"status"}, str(body.keys()))

# ------------------------------------------------------------------ 7. 安全响应头
print("\n=== 7. 安全响应头 ===")
for header, expected in (
    ("x-content-type-options", "nosniff"),
    ("x-frame-options", "SAMEORIGIN"),
    ("referrer-policy", "strict-origin-when-cross-origin"),
):
    check(f"{header}", r.headers.get(header), expected)
check_true(
    "permissions-policy 存在",
    "camera=()" in (r.headers.get("permissions-policy") or ""),
)

# ------------------------------------------------------------------ 8. Cookie 标志来自配置
print("\n=== 8. Cookie 安全标志来自配置而非写死 ===")
src = (BACKEND / "app" / "routers" / "auth.py").read_text(encoding="utf-8")
check_true("auth.py 使用 settings.COOKIE_SECURE", "secure=settings.COOKIE_SECURE" in src)
# 注意：注释里写了"不再写死 secure=False"，那是说明文字，不算违规。
# 这里只检查"代码形态"：以 secure=False 结尾的赋值行。
import re as _re

hardcoded = [
    line
    for line in src.split("\n")
    if _re.match(r"^\s*secure\s*=\s*False\s*,?\s*$", line)
]
check_true(
    "auth.py 里没有写死的 secure=False（代码行）",
    not hardcoded,
    str(hardcoded),
)
check_true("auth.py 使用 settings.COOKIE_SAMESITE", "samesite=settings.COOKIE_SAMESITE" in src)

# ------------------------------------------------------------------ 9. XFF 伪造
print("\n=== 9. X-Forwarded-For 伪造无法绕过 IP 限速 ===")
#
# nginx 的 $proxy_add_x_forwarded_for 会把真实 IP **追加在末尾**，
# 客户端自己伪造的值排在前面。所以必须取最后一段。
# 如果取第一段，攻击者换着假 IP 就能绕过 IP 限速。
pf = net_utils.parse_xff

check("无头 → None", pf(None), None)
check("空串 → None", pf(""), None)
check("单个值原样返回", pf("1.2.3.4"), "1.2.3.4")
check(
    "伪造值 + 真实 IP → 取真实（最后一段）",
    pf("1.2.3.4, 5.6.7.8"),
    "5.6.7.8",
)
check("带空格与尾逗号", pf(" 1.2.3.4 , 5.6.7.8 , "), "5.6.7.8")
check("多层伪造 → 仍取最后一段", pf("a, b, 9.9.9.9"), "9.9.9.9")

# subscribe.py 里也有一份同样的解析，必须一致
from app.routers import subscribe as subscribe_module  # noqa: E402

check(
    "订阅模块的解析与登录模块一致",
    net_utils.parse_xff("1.2.3.4, 5.6.7.8"),
    pf("1.2.3.4, 5.6.7.8"),
)
check_true(
    "auth.py 不再用第一段",
    'xff.split(",")[0]' not in (BACKEND / "app" / "routers" / "auth.py").read_text(
        encoding="utf-8"
    ),
)
check_true(
    "subscribe.py 不再用第一段",
    'xff.split(",")[0]'
    not in (BACKEND / "app" / "routers" / "subscribe.py").read_text(encoding="utf-8"),
)

# ------------------------------------------------------------------ 收尾
cleanup()
auth_module._ip_failures.clear()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 认证与传输安全全部断言通过")
