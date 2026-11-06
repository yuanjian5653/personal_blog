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
            select(Subscriber).where(
                (Subscriber.email == TEST_EMAIL)
                | Subscriber.email.startswith(PREFIX)
            )
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

# ------------------------------------------------------------------ 游标续传
print("\n=== 10. 发送游标（中断后续传，不重复发）===")
#
# 这里把 mailer.try_send_mail 换成假的，记录"这一轮发给了谁"，
# 这样不用真的发信就能验证续传逻辑。
sent_to: list[str] = []
real_try_send = notifier.mailer.try_send_mail


async def fake_try_send(to_email, subject, text, html, unsubscribe_url=None):
    sent_to.append(to_email)
    return True, None


notifier.mailer.try_send_mail = fake_try_send
notifier.SEND_INTERVAL = 0

# 造 3 个已确认订阅者
CURSOR_EMAILS = [f"{PREFIX}cursor{i}@example.com" for i in (1, 2, 3)]
with Session(engine) as db:
    for i, em in enumerate(CURSOR_EMAILS):
        db.add(Subscriber(
            email=em,
            status="confirmed",
            confirm_token=f"__notify_cursor_ct_{i}_" + "x" * 10,
            unsubscribe_token=f"__notify_cursor_ut_{i}_" + "y" * 10,
            source="test",
            created_at=datetime.now(timezone.utc),
            confirmed_at=datetime.now(timezone.utc),
        ))
    db.commit()

with Session(engine) as db:
    ids = [
        x[0]
        for x in db.exec(
            select(Subscriber.id)
            .where(Subscriber.email.in_(CURSOR_EMAILS))
            .order_by(Subscriber.id)
        ).all()
    ]
check("3 个订阅者 id 递增", ids == sorted(ids), True)
first_id, second_id, third_id = ids

# ---- 第一轮：全新记录，游标为空 → 应该发给全部 3 人 ----
notifier._enqueue("essay.new", "essay", 910001, PREFIX + "游标一", None, "/essays")
row1 = rows_by_title(PREFIX + "游标一")[0]
sent_to.clear()
asyncio.run(notifier._send_batch())
row1 = rows_by_title(PREFIX + "游标一")[0]
# 注意：开发库里可能还有**真实的**已确认订阅者（比如你自己的邮箱），
# 所以这里不写死"只有 3 个"，而是断言 3 个测试邮箱都被发到了。
check("3 个测试订阅者都被发到", all(e in sent_to for e in CURSOR_EMAILS), True)
check("最后发的是 id 最大那个", sent_to[-1], CURSOR_EMAILS[-1])
check("首轮后状态 sent", row1.status, "sent")
check("sent_count 与本轮发送数一致", row1.sent_count, len(sent_to))
check("游标停在最后一个人", row1.last_commenter_id, third_id)

# ---- 第二轮：人为把游标设成第 1 个人，模拟"发到第 1 个就被 kill" ----
notifier._enqueue("essay.new", "essay", 910002, PREFIX + "游标二", None, "/essays")
with Session(engine) as db:
    r = db.exec(
        select(NotificationOutbox).where(
            NotificationOutbox.title == PREFIX + "游标二"
        )
    ).first()
    obj = r[0] if not isinstance(r, NotificationOutbox) else r
    obj.last_commenter_id = first_id
    obj.sent_count = 1
    obj.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=2)
    db.add(obj)
    db.commit()

sent_to.clear()
asyncio.run(notifier._send_batch())
row2 = rows_by_title(PREFIX + "游标二")[0]
check("续传只发给游标之后的 2 人", sent_to, CURSOR_EMAILS[1:])
check("第一个人没有被重发", CURSOR_EMAILS[0] in sent_to, False)
check("sent_count 累加（1 + 本轮 2）", row2.sent_count, 3)
check("游标推进到最后一个", row2.last_commenter_id, third_id)

# ---- 游标已经在最后一个人：不应再发任何人 ----
notifier._enqueue("essay.new", "essay", 910003, PREFIX + "游标三", None, "/essays")
with Session(engine) as db:
    r = db.exec(
        select(NotificationOutbox).where(
            NotificationOutbox.title == PREFIX + "游标三"
        )
    ).first()
    obj = r[0] if not isinstance(r, NotificationOutbox) else r
    obj.last_commenter_id = third_id
    obj.sent_count = 3
    obj.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=2)
    db.add(obj)
    db.commit()

sent_to.clear()
asyncio.run(notifier._send_batch())
row3 = rows_by_title(PREFIX + "游标三")[0]
check("游标已到末尾 → 一个人都不发", sent_to, [])
check("仍然标记为 sent（不会无限堆积）", row3.status, "sent")

# ------------------------------------------------------------------ 网站更新公告
print("\n=== 11. 网站更新公告 ===")
# immediate=True 时无视冷却
settings.NOTIFY_COOLDOWN_MINUTES = 120
before = datetime.now(timezone.utc)
ok = notifier.enqueue_site_update(PREFIX + "站点更新", "改了导航", "/about", immediate=True)
check("入队成功", ok, True)

with Session(engine) as db:
    r = db.exec(
        select(NotificationOutbox).where(
            NotificationOutbox.title == PREFIX + "站点更新"
        )
    ).first()
    site_row = r[0] if not isinstance(r, NotificationOutbox) else r
check("event_type 是 site.update", site_row.event_type, "site.update")
check("target_type 是 site", site_row.target_type, "site")
check("link 用的是传入路径", site_row.url, "/about")
delta = (site_row.scheduled_at - before).total_seconds()
check_true("immediate 时不被冷却顺延", -2 <= delta <= 5, f"{delta:.1f} 秒")

# 冷却生效时（immediate=False）会被顺延
ok = notifier.enqueue_site_update(PREFIX + "站点更新慢", None, "/", immediate=False)
with Session(engine) as db:
    r = db.exec(
        select(NotificationOutbox).where(
            NotificationOutbox.title == PREFIX + "站点更新慢"
        )
    ).first()
    slow_row = r[0] if not isinstance(r, NotificationOutbox) else r
slow_delta = (slow_row.scheduled_at - datetime.now(timezone.utc)).total_seconds() / 60
check_true(
    "immediate=False 时会被顺延到冷却期后",
    slow_delta > 60,
    f"顺延 {slow_delta:.0f} 分钟",
)

# 邮件标题要用"网站更新"这个措辞
subj, text, html = notifier.render_digest([site_row], "https://x/u?t=t")
check_true("主题含「网站更新」", "网站更新" in subj, subj)
check_true("正文含标题", PREFIX + "站点更新" in text, text[:60])

# 跑一轮把它发出去（fake 发送器仍然生效）
sent_to.clear()
with Session(engine) as db:
    for r in db.exec(select(NotificationOutbox)).all():
        obj = r[0] if not isinstance(r, NotificationOutbox) else r
        if isinstance(obj, NotificationOutbox) and obj.title.startswith(PREFIX):
            if obj.status == "pending":
                obj.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=2)
                db.add(obj)
    db.commit()
asyncio.run(notifier._send_batch())
check_true("公告也走同一条发送管道", len(sent_to) >= 3, str(len(sent_to)))

# 恢复真实发送器
notifier.mailer.try_send_mail = real_try_send

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
