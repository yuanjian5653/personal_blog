"""
站点配置接口的「密钥不公开」回归测试。

背景：GET /api/site-config 是匿名可访问的（前台要用它渲染主题、站点名等），
但它之前把整张配置表都返回了 —— 包括 netease_music_u。那是网易云的
MUSIC_U Cookie，拿到它等于登录站长的网易云账号。

这个测试用真实路由 + 真实数据库 + **真实会话 Cookie**，验证：
  · 匿名请求拿不到 netease_music_u，但公开项（site_title 等）照常返回
  · 带有效管理员 Cookie 时能拿到 netease_music_u（后台站点配置页要显示它）

用法：python scripts/test_site_config_privacy.py [--allow-production-db]
"""
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, select

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import admin_id_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, AdminSession  # noqa: E402
from app.services.site_config import SECRET_CONFIG_KEYS  # noqa: E402

engine = create_engine(settings.DATABASE_URL, echo=False)

FAILS: list[str] = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(f"{label}: got={got!r} want={want!r}")


def check_true(label, cond, extra=""):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(f"{label} {extra}")


guard("test_site_config_privacy")

with Session(engine) as db:
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("数据库里没有管理员，无法测试")
    raise SystemExit(0)

print("=== 1. 密钥清单本身 ===")
check_true(
    "netease_music_u 被标记为密钥",
    "netease_music_u" in SECRET_CONFIG_KEYS,
    f"实际={sorted(SECRET_CONFIG_KEYS)}",
)

print("\n=== 2. 匿名访问（不带 Cookie）===")
anon = TestClient(app)
r = anon.get("/api/site-config")
check("HTTP 200", r.status_code, 200)
anon_cfg = r.json().get("configs", {})

for k in SECRET_CONFIG_KEYS:
    check_true(f"公开响应不含密钥 {k}", k not in anon_cfg, f"值={anon_cfg.get(k)!r}")

check_true("公开响应仍含 site_title", "site_title" in anon_cfg)
check_true("公开响应仍含 icp_number", "icp_number" in anon_cfg)
check_true(
    "公开响应仍含 netease_playlist_id（歌单 ID 不是密钥）",
    "netease_playlist_id" in anon_cfg,
)

print("\n=== 3. 管理员访问（真实会话 Cookie）===")
token = secrets.token_urlsafe(32)
with Session(engine) as db:
    db.add(
        AdminSession(
            session_token=token,
            admin_id=admin_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
    )
    db.commit()

try:
    admin_client = TestClient(app)
    r2 = admin_client.get("/api/site-config", cookies={"session_token": token})
    check("HTTP 200", r2.status_code, 200)
    admin_cfg = r2.json().get("configs", {})

    for k in SECRET_CONFIG_KEYS:
        check_true(f"管理员响应含 {k}", k in admin_cfg)

    check_true(
        "管理员比匿名多出的字段数 = 密钥数",
        len(admin_cfg) - len(anon_cfg) == len(SECRET_CONFIG_KEYS),
        f"admin={len(admin_cfg)} anon={len(anon_cfg)} secrets={len(SECRET_CONFIG_KEYS)}",
    )
finally:
    # 清掉临时会话，别在库里留垃圾
    with Session(engine) as db:
        s = db.exec(
            select(AdminSession).where(AdminSession.session_token == token)
        ).first()
        if s:
            db.delete(s)
            db.commit()

print("\n=== 4. 伪造 Cookie 仍然拿不到密钥 ===")
fake = TestClient(app)
r3 = fake.get("/api/site-config", cookies={"session_token": "forged-token-xxx"})
check("HTTP 200（公开接口不因伪造 Cookie 报错）", r3.status_code, 200)
fake_cfg = r3.json().get("configs", {})
for k in SECRET_CONFIG_KEYS:
    check_true(f"伪造 Cookie 拿不到 {k}", k not in fake_cfg)
check_true("字段数与匿名一致", len(fake_cfg) == len(anon_cfg))

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] 站点配置的密钥隔离全部断言通过")
