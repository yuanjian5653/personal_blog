"""
内容更新通知（outbox + worker）的测试。

覆盖：
  · 表与唯一约束存在
  · 入队幂等：同一篇内容重复入队只留一条
  · 冷却合并：冷却期内入队会被顺延；冷却期为 0 时立即到期
  · 摘要清洗：Markdown 标记被去掉、长度受限
  · 邮件渲染：单条用标题做主题、多条合并成"更新了 N 条"、退订链接出现在两个版本里
  · 一批到期 + 无订阅者 → 标记 sent 且 sent_count=0（不会无限堆积）
  · 一批到期 + 有订阅者但邮件未配置 → 全部失败 → attempts+1、顺延重试；
    达到 3 次后变 failed
  · 崩溃遗留的 sending 记录会被重置回 pending
  · 后台接口：列表 / 重试 / 删除

用法：python scripts/test_notifier.py --allow-production-db
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import admin_id_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.deps import get_current_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, NotificationOutbox, Subscriber  # noqa: E402
from app.services import notifier  # noqa: E402

guard("test_notifier.py")
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []

PREFIX = "__notify_test_"
TEST_EMAIL = "__notify_test_sub@example.com"


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


def unwrap(row, model):
    if row is None:
        return None
    if isinstance(row, model):
        return row
    try:
        first = row[0]
        return first if isinstance(first, model) else None
    except (TypeError, IndexError, KeyError):
        return None


def rows_by_title(title_prefix: str) -> list[NotificationOutbox]:
    with Session(engine) as db:
        raw = db.exec(
            select(NotificationOutbox).where(
                NotificationOutbox.title.startswith(title_prefix)
            )
        ).all()
    return [x for x in (unwrap(r, NotificationOutbox) for r in raw) if x is not None]


def cleanup() -> None:
    with Session(engine) as db:
        raw = db.exec(
            select(NotificationOutbox).where(
                NotificationOutbox.title.startswith(PREFIX)
            )
        ).all()
        for r in raw:
            obj = unwrap(r, NotificationOutbox)
            if obj is not None:
                db.delete(obj)

        raw_sub = db.exec(
            select(Subscriber).where(Subscriber.email == TEST_EMAIL)
        ).all()
        for r in raw_sub:
            obj = unwrap(r, Subscriber)
            if obj is not None:
                db.delete(obj)
        db.commit()


cleanup()

# 测试期间把发送间隔设为 0，别等 0.5 秒/封
original_interval = notifier.SEND_INTERVAL
notifier.SEND_INTERVAL = 0
# 关掉冷却，让入队立即到期（单独测冷却时会临时打开）
original_cooldown = settings.NOTIFY_COOLDOWN_MINUTES
settings.NOTIFY_COOLDOWN_MINUTES = 0

# ------------------------------------------------------------------ 表
print("=== 1. 表结构 ===")
insp = inspect(engine)
check_true("notification_outbox 表存在", "notification_outbox" in insp.get_table_names())
cols = [c["name"] for c in insp.get_columns("notification_outbox")]
for need in ("event_type", "target_type", "target_id", "title", "url",
             "status", "scheduled_at", "attempts", "sent_count", "sent_at"):
    check_true(f"列 {need}", need in cols)

# ------------------------------------------------------------------ 入队幂等
print("\n=== 2. 入队幂等 ===")
ok1 = notifier._enqueue(
    "essay.new", "essay", 900001, PREFIX + "第一条", "摘要一", "/essays"
)
ok2 = notifier._enqueue(
    "essay.new", "essay", 900001, PREFIX + "第一条", "摘要一", "/essays"
)
check("第一次入队返回 True", ok1, True)
check("重复入队返回 False", ok2, False)
check("库里只有一条", len(rows_by_title(PREFIX)), 1)

# 不同 target_id 可以并存
ok3 = notifier._enqueue(
    "life.new", "life", 900002, PREFIX + "第二条", None, "/life"
)
check("不同内容可以入队", ok3, True)
check("库里两条", len(rows_by_title(PREFIX)), 2)

# ------------------------------------------------------------------ 冷却
print("\n=== 3. 冷却合并 ===")
# 人为造一条"刚发过"的 sent 记录
with Session(engine) as db:
    sent_row = NotificationOutbox(
        event_type="article.new", target_type="article", target_id=900003,
        title=PREFIX + "已发过的", url="/articles/x", status="sent",
        scheduled_at=datetime.now(timezone.utc),
        sent_at=datetime.now(timezone.utc),
        sent_count=1,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(sent_row)
    db.commit()

settings.NOTIFY_COOLDOWN_MINUTES = 120
before = datetime.now(timezone.utc)
notifier._enqueue("essay.new", "essay", 900004, PREFIX + "冷却期内", None, "/essays")
rows = [r for r in rows_by_title(PREFIX + "冷却期内")]
check_true("冷却期内入队成功", len(rows) == 1)
if rows:
    delta_min = (rows[0].scheduled_at - before).total_seconds() / 60
    check_true(
        "scheduled_at 被顺延了约 120 分钟",
        110 <= delta_min <= 125,
        f"实际顺延 {delta_min:.1f} 分钟",
    )

settings.NOTIFY_COOLDOWN_MINUTES = 0
before2 = datetime.now(timezone.utc)
notifier._enqueue("essay.new", "essay", 900005, PREFIX + "冷却关闭", None, "/essays")
rows2 = rows_by_title(PREFIX + "冷却关闭")
if rows2:
    delta2 = (rows2[0].scheduled_at - before2).total_seconds()
    check_true("冷却为 0 时立即到期", -2 <= delta2 <= 5, f"{delta2:.1f} 秒")

# ------------------------------------------------------------------ 摘要清洗
print("\n=== 4. 摘要清洗 _plain() ===")
raw_md = """
# 标题

这是一段**加粗**的文字，还有 [链接](https://x.com) 和 ![图](a.png)。

```python
code()
```
"""
plain = notifier._plain(raw_md, 40)
check_true("去掉了 # 号", "#" not in plain, plain)
check_true("去掉了 ** 号", "**" not in plain, plain)
check_true("保留了链接文字", "链接" in plain, plain)
check_true("去掉了图片", "图]" not in plain and ".png" not in plain, plain)
check_true("去掉了代码块", "code()" not in plain, plain)
check_true("长度受限", len(notifier._plain(raw_md, 10)) <= 10)

# ------------------------------------------------------------------ 邮件渲染
print("\n=== 5. 邮件渲染 render_digest() ===")
one = rows_by_title(PREFIX + "第一条")
subj, text, html = notifier.render_digest(one, "https://x/unsub?token=t")
check_true("单条：主题含标题", PREFIX + "第一条" in subj, subj)
check_true("单条：主题用事件类型措辞", "新随笔" in subj, subj)
check_true("纯文本含退订链接", "https://x/unsub?token=t" in text)
check_true("HTML 含退订链接", "https://x/unsub?token=t" in html)
check_true("HTML 含正文链接", settings.SITE_URL + "/essays" in html)

two = rows_by_title(PREFIX)
subj2, text2, html2 = notifier.render_digest(two, "https://x/unsub?token=t")
check_true("多条：主题变成计数", "条内容" in subj2, subj2)
check_true("多条：纯文本列出每一条",
           all(t.title in text2 for t in two), text2[:120])

# ------------------------------------------------------------------ 无订阅者
print("\n=== 6. 到期但没有订阅者 ===")
# 先把之前造的 sent 行删掉，避免影响冷却（此时冷却已是 0）
with Session(engine) as db:
    for r in db.exec(select(NotificationOutbox)).all():
        obj = unwrap(r, NotificationOutbox)
        if obj is not None and obj.status == "sent":
            db.delete(obj)
    db.commit()

# 冷却测试把某条记录的 scheduled_at 顺延到了 120 分钟后，
# 这里先全部拉回"现在"，否则它当然不会被处理 —— 那是测试自身的问题。
with Session(engine) as db:
    for r in db.exec(select(NotificationOutbox)).all():
        obj = unwrap(r, NotificationOutbox)
        if obj is not None and obj.title.startswith(PREFIX):
            obj.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=2)
            db.add(obj)
    db.commit()

asyncio.run(notifier._send_batch())
rows_now = rows_by_title(PREFIX)
check_true(
    "全部被标记为 sent（不堆积）",
    all(r.status == "sent" for r in rows_now),
    str([(r.title, r.status) for r in rows_now]),
)
check_true(
    "sent_count 为 0",
    all(r.sent_count == 0 for r in rows_now),
)

# ------------------------------------------------------------------ 有订阅者但发不出去
print("\n=== 7. 有订阅者、邮件未配置 → 重试机制 ===")
with Session(engine) as db:
    db.add(Subscriber(
        email=TEST_EMAIL,
        status="confirmed",
        confirm_token="__notify_test_ct_" + "x" * 20,
        unsubscribe_token="__notify_test_ut_" + "y" * 20,
        source="test",
        created_at=datetime.now(timezone.utc),
        confirmed_at=datetime.now(timezone.utc),
    ))
    db.commit()

notifier._enqueue("essay.new", "essay", 900006, PREFIX + "发不出去的", None, "/essays")
row = rows_by_title(PREFIX + "发不出去的")[0]
check("初始 pending", row.status, "pending")

asyncio.run(notifier._send_batch())
row = rows_by_title(PREFIX + "发不出去的")[0]
check("失败后 attempts=1", row.attempts, 1)
check("失败后仍是 pending（等待重试）", row.status, "pending")
check_true("记录了错误信息", bool(row.last_error), str(row.last_error))
check_true(
    "scheduled_at 被顺延到将来",
    row.scheduled_at > datetime.now(timezone.utc),
)

# 再跑两轮 → 达到 3 次变 failed
for _ in range(2):
    with Session(engine) as db:
        r = db.get(NotificationOutbox, row.id)
        if r is not None:
            r.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.add(r)
            db.commit()
    asyncio.run(notifier._send_batch())

row = rows_by_title(PREFIX + "发不出去的")[0]
check("三次失败后 attempts=3", row.attempts, 3)
check("三次失败后 status=failed", row.status, "failed")

# ------------------------------------------------------------------ 崩溃遗留
print("\n=== 8. 卡在 sending 的记录会被重置 ===")
stale_id = None
with Session(engine) as db:
    stale = NotificationOutbox(
        event_type="essay.new", target_type="essay", target_id=900007,
        title=PREFIX + "卡住的", url="/essays", status="sending",
        scheduled_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        # 故意做成 30 分钟前更新
        updated_at=datetime.now(timezone.utc) - timedelta(minutes=30),
    )
    db.add(stale)
    db.commit()
    stale_id = stale.id

asyncio.run(notifier._send_batch())
with Session(engine) as db:
    r = db.get(NotificationOutbox, stale_id)
check_true("卡住的记录被重置为 pending 或已处理",
           r is not None and r.status in ("pending", "sent", "failed"),
           str(r.status if r else None))

# ------------------------------------------------------------------ 后台接口
print("\n=== 9. 后台接口 ===")
with Session(engine) as db:
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("没有管理员账号，跳过后台部分")
else:
    app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=admin_id)
    client = TestClient(app)

    r = client.get("/api/admin/notifications")
    check_true("列表 200", r.status_code == 200, str(r.status_code))
    data = r.json()
    check_true("有 counts", "counts" in data)
    check_true("有 items", "items" in data)
    check_true("有 mail_configured", "mail_configured" in data)
    check_true("能看到测试数据", any(i["title"].startswith(PREFIX) for i in data["items"]))

    # 重试一条 failed 的
    failed = [i for i in data["items"] if i["status"] == "failed" and i["title"].startswith(PREFIX)]
    if failed:
        r = client.post(f"/api/admin/notifications/{failed[0]['id']}/retry")
        check_true("对 failed 重试 200", r.status_code == 200, str(r.status_code))
        with Session(engine) as db:
            rr = db.get(NotificationOutbox, failed[0]["id"])
        check("重试后回到 pending", rr.status, "pending")
        check("重试后 attempts 归零", rr.attempts, 0)

    # 已发送的不能重试
    sent = [i for i in data["items"] if i["status"] == "sent" and i["title"].startswith(PREFIX)]
    if sent:
        r = client.post(f"/api/admin/notifications/{sent[0]['id']}/retry")
        check_true("对 sent 重试返回 400", r.status_code == 400, str(r.status_code))

    # 删除
    target = data["items"][0]["id"]
    r = client.delete(f"/api/admin/notifications/{target}")
    check_true("删除 200", r.status_code == 200, str(r.status_code))
    r = client.delete("/api/admin/notifications/999999")
    check_true("删除不存在 404", r.status_code == 404, str(r.status_code))

# ------------------------------------------------------------------ 收尾
notifier.SEND_INTERVAL = original_interval
settings.NOTIFY_COOLDOWN_MINUTES = original_cooldown
cleanup()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 通知队列与 worker 全部断言通过")
