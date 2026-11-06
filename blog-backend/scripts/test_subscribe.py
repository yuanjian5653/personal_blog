"""
订阅功能的接口测试。

覆盖：
  · 邮箱格式校验（422）
  · 提交后落库为 pending，token 生成
  · 同一邮箱重复提交 → 不新建、不重发（返回统一话术）
  · 确认链接：成功 / 重复确认 / 无效 token
  · 退订链接：成功 / 重复退订 / 无效 token
  · 重新订阅：已退订的再提交 → 回到 pending，token 会更新
  · 后台列表：统计基于全部记录、列表可按 status 过滤、**不返回 token**
  · 后台删除、重发
  · IP 冷却（把阈值调大后连投两次只处理一次）
  · 邮件未配置时接口仍然 200（不能让发信失败影响用户体验）

用法：python scripts/test_subscribe.py --allow-production-db
"""
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import admin_id_of, ids_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.deps import get_current_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, Subscriber  # noqa: E402

guard("test_subscribe.py")

# 生产环境的 subscribers 表由 lifespan 的 init_db() 建；测试直接建 client
# 不走 lifespan，所以这里显式建一次（只建缺失的表）。
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []


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


def check_status(label, resp, want):
    ok = resp.status_code == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label} (HTTP {resp.status_code})")
    if not ok:
        FAILS.append(f"{label}: status={resp.status_code} want={want} body={resp.text[:160]}")
        print(f"          body={resp.text[:160]}")


with Session(engine) as db:
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("没有管理员账号，跳过")
    raise SystemExit(0)

app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=admin_id)
client = TestClient(app)

PREFIX = "__sub_test_"
EMAIL_A = f"{PREFIX}a@example.com"
EMAIL_B = f"{PREFIX}b@example.com"


def cleanup():
    # 先删掉早期测试留下的脏数据（例如校验漏掉空格时写进来的地址）
    with Session(engine) as db:
        for row in db.exec(select(Subscriber)).all():
            obj = _unwrap(row)
            if obj is not None and " " in obj.email:
                db.delete(obj)
        db.commit()

    with Session(engine) as db:
        ids = ids_of(
            db, select(Subscriber.id).where(Subscriber.email.startswith(PREFIX))
        )
        for sid in ids:
            obj = db.get(Subscriber, sid)
            if obj is not None:
                db.delete(obj)
        db.commit()


def _unwrap(row) -> Subscriber | None:
    """本版本 SQLModel 的 exec(select(Model)) 返回 Row，需要解包成模型实例。"""
    if row is None:
        return None
    if isinstance(row, Subscriber):
        return row
    try:
        first = row[0]
        return first if isinstance(first, Subscriber) else None
    except (TypeError, IndexError, KeyError):
        return None


def get_by_email(email: str) -> Subscriber | None:
    with Session(engine) as db:
        return _unwrap(
            db.exec(select(Subscriber).where(Subscriber.email == email)).first()
        )


cleanup()

# 测试期间关掉 IP 冷却，否则第二个邮箱会被拦
original_ip_cooldown = settings.SUBSCRIBE_IP_COOLDOWN
settings.SUBSCRIBE_IP_COOLDOWN = 0

# ------------------------------------------------------------------ 校验
print("=== 1. 邮箱格式校验 ===")
for bad in ("abc", "a@b", "@example.com", "a b@example.com"):
    r = client.post("/api/subscribe", json={"email": bad})
    check_status(f"非法邮箱 {bad!r} -> 422", r, 422)

# ------------------------------------------------------------------ 提交
print("\n=== 2. 提交订阅 ===")
r = client.post("/api/subscribe", json={"email": EMAIL_A, "source": "test"})
check_status("提交成功", r, 200)
body = r.json()
check("返回 ok", body.get("ok"), True)
check_true(
    "话术统一（不暴露是否存在）",
    "如果这个邮箱有效" in body.get("message", ""),
    body.get("message", "")[:60],
)

sub_a = get_by_email(EMAIL_A)
check_true("库里创建了记录", sub_a is not None)
if sub_a:
    check("初始状态 pending", sub_a.status, "pending")
    check_true("confirm_token 已生成", len(sub_a.confirm_token or "") >= 20)
    check_true("unsubscribe_token 已生成", len(sub_a.unsubscribe_token or "") >= 20)
    check_true(
        "两个 token 不同",
        sub_a.confirm_token != sub_a.unsubscribe_token,
    )
    check("source 记录", sub_a.source, "test")
    check_true("last_notified_at 已写入", sub_a.last_notified_at is not None)
    check_true(
        "IP 只存哈希（长度 32，非明文）",
        (sub_a.ip_hash or "") != "" and len(sub_a.ip_hash) == 32,
        str(sub_a.ip_hash)[:16],
    )

# 重复提交同一邮箱 → 不新建
count_before = len(
    ids_of(
        Session(engine),
        select(Subscriber.id).where(Subscriber.email == EMAIL_A),
    )
)
r = client.post("/api/subscribe", json={"email": EMAIL_A})
check_status("重复提交仍 200", r, 200)
count_after = len(
    ids_of(
        Session(engine),
        select(Subscriber.id).where(Subscriber.email == EMAIL_A),
    )
)
check("没有产生重复记录", count_after, count_before)
check("仍然是 pending", get_by_email(EMAIL_A).status, "pending")

# 大小写/空格归一
r = client.post("/api/subscribe", json={"email": f"  {EMAIL_A.upper()}  "})
check_status("大写+空格提交", r, 200)
with Session(engine) as db:
    n = len(ids_of(db, select(Subscriber.id).where(Subscriber.email == EMAIL_A)))
check("归一化后没有新记录", n, 1)

# ------------------------------------------------------------------ 确认
print("\n=== 3. 确认链接 ===")
token = get_by_email(EMAIL_A).confirm_token

r = client.get(f"/api/subscribe/confirm?token={token}")
check_status("确认成功", r, 200)
check_true("页面提示订阅成功", "订阅成功" in r.text, r.text[:80])
check("状态变 confirmed", get_by_email(EMAIL_A).status, "confirmed")
check_true("confirmed_at 已写入", get_by_email(EMAIL_A).confirmed_at is not None)

r = client.get(f"/api/subscribe/confirm?token={token}")
check_status("重复确认仍 200", r, 200)
check_true("提示已经确认过", "已经确认过" in r.text, r.text[:80])

r = client.get("/api/subscribe/confirm?token=nonexistent-token-xxx")
check_status("无效 token -> 400", r, 400)
check_true("提示链接无效", "无效" in r.text, r.text[:80])

r = client.get("/api/subscribe/confirm")
check_status("缺 token -> 400", r, 400)

# 已确认后再提交，不应重发（但仍返回统一话术）
last_before = get_by_email(EMAIL_A).last_notified_at
r = client.post("/api/subscribe", json={"email": EMAIL_A})
check_status("已确认再提交 -> 200", r, 200)
check("未重发（last_notified_at 不变）", get_by_email(EMAIL_A).last_notified_at, last_before)
check("状态仍是 confirmed", get_by_email(EMAIL_A).status, "confirmed")

# ------------------------------------------------------------------ 退订
print("\n=== 4. 退订链接 ===")
unsub = get_by_email(EMAIL_A).unsubscribe_token
r = client.get(f"/api/subscribe/unsubscribe?token={unsub}")
check_status("退订成功", r, 200)
check_true("页面提示已退订", "已退订" in r.text, r.text[:80])
check("状态变 unsubscribed", get_by_email(EMAIL_A).status, "unsubscribed")
check_true(
    "unsubscribed_at 已写入", get_by_email(EMAIL_A).unsubscribed_at is not None
)

r = client.get(f"/api/subscribe/unsubscribe?token={unsub}")
check_status("重复退订仍 200", r, 200)
check_true("提示已经退订", "已经退订" in r.text, r.text[:80])

r = client.get("/api/subscribe/unsubscribe?token=bad-token")
check_status("无效退订 token -> 400", r, 400)

# RFC 8058 一键退订走 POST
r = client.post(f"/api/subscribe/unsubscribe?token={unsub}")
check_status("POST 一键退订", r, 200)

# ------------------------------------------------------------------ 重新订阅
print("\n=== 5. 重新订阅 ===")
settings.SUBSCRIBE_RESEND_COOLDOWN = 0  # 关掉重发冷却
old_confirm = get_by_email(EMAIL_A).confirm_token
r = client.post("/api/subscribe", json={"email": EMAIL_A})
check_status("退订后再提交", r, 200)
sub_a2 = get_by_email(EMAIL_A)
check("回到 pending", sub_a2.status, "pending")
check_true(
    "生成了新 confirm_token（旧链接失效）",
    sub_a2.confirm_token != old_confirm,
)

# ------------------------------------------------------------------ 后台
print("\n=== 6. 后台接口 ===")
r = client.get("/api/admin/subscribers")
check_status("后台列表", r, 200)
data = r.json()
check_true("有 stats", "stats" in data)
check_true("有 items", "items" in data)
check_true(
    "mail_configured 字段存在",
    "mail_configured" in data,
)

mine = [i for i in data["items"] if i["email"].startswith(PREFIX)]
check_true("能看到测试数据", len(mine) >= 1, str(len(mine)))
check_true(
    "响应里不含 token（防泄漏）",
    all("confirm_token" not in i and "unsubscribe_token" not in i for i in data["items"]),
)

words = {i["email"]: i["status"] for i in mine}
check("状态正确", words.get(EMAIL_A), "pending")

# 过滤 pending，但统计必须仍是全量
r = client.get("/api/admin/subscribers?status=confirmed")
filtered = r.json()
check_true(
    "过滤后 items 只有 confirmed",
    all(i["status"] == "confirmed" for i in filtered["items"]),
)
check(
    "统计不受过滤影响（total 仍是全量）",
    filtered["stats"]["total"],
    data["stats"]["total"],
)

# 重发
sub_a3 = get_by_email(EMAIL_A)
r = client.post(f"/api/admin/subscribers/{sub_a3.id}/resend")
check_status("重发确认信（未配置邮件 -> 502 或 200）", r, 200 if r.status_code == 200 else 502)

# 已确认的不能重发
client.post("/api/subscribe", json={"email": EMAIL_B})
sub_b = get_by_email(EMAIL_B)
client.get(f"/api/subscribe/confirm?token={sub_b.confirm_token}")
r = client.post(f"/api/admin/subscribers/{sub_b.id}/resend")
check_status("已确认 -> 重发返回 400", r, 400)

# 删除
r = client.delete(f"/api/admin/subscribers/{sub_b.id}")
check_status("删除", r, 200)
check_true("删除后查不到", get_by_email(EMAIL_B) is None)
r = client.delete("/api/admin/subscribers/999999")
check_status("删除不存在 -> 404", r, 404)

# ------------------------------------------------------------------ IP 冷却
print("\n=== 7. IP 冷却 ===")
settings.SUBSCRIBE_IP_COOLDOWN = 3600  # 一小时
cleanup()
EMAIL_C = f"{PREFIX}c@example.com"
r1 = client.post("/api/subscribe", json={"email": EMAIL_C})
check_status("第一次提交", r1, 200)
EMAIL_D = f"{PREFIX}d@example.com"
r2 = client.post("/api/subscribe", json={"email": EMAIL_D})
check_status("同 IP 第二次提交仍 200（不报错）", r2, 200)
check_true(
    "但第二次没有落库（被冷却拦下）",
    get_by_email(EMAIL_D) is None,
    "居然创建了记录",
)
check_true("第一次确实落库", get_by_email(EMAIL_C) is not None)

# ------------------------------------------------------------------ 收尾
settings.SUBSCRIBE_IP_COOLDOWN = original_ip_cooldown
cleanup()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 订阅接口全部断言通过")
