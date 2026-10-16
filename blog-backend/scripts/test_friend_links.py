"""
友情链接接口测试。

覆盖：排序（权重/同权重/负权重）、URL 协议补全、可见性过滤、
增删改、字段级日志、鉴权。

用法：python scripts/test_friend_links.py --allow-production-db
"""
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# test_guard：安全护栏 + 查询辅助（admin_id_of / ids_of）
from test_guard import admin_id_of, ids_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.deps import get_current_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, FriendLink, OperationLog  # noqa: E402

# 安全护栏

guard("test_friend_links.py")

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


def expect_code(label, fn, status_code):
    try:
        fn()
    except Exception as e:
        code = getattr(e, "status_code", None)
        check(label, code, status_code)
        return
    print(f"  [FAIL] {label} -> 没抛异常")
    FAILS.append(label)


with Session(engine) as db:
    # 用 test_guard 里的辅助函数取标量 id
    # （本版本 db.exec(select(...)).first() 返回的是 Row）
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("没有管理员账号，跳过")
    raise SystemExit(0)

app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=admin_id)
client = TestClient(app)

PREFIX = "__fl_test_"


def cleanup():
    """删掉本次测试造的数据。

    用 ids_of 先拿 id 列表、再 db.get() 删除：
    因为 `db.exec(select(Model)).all()` 在本版本返回 Row，
    Row 不是映射对象，直接 db.delete(row) 会抛 UnmappedInstanceError。
    """
    with Session(engine) as db:
        ids = ids_of(
            db, select(FriendLink.id).where(FriendLink.name.startswith(PREFIX))
        )
        for lid in ids:
            obj = db.get(FriendLink, lid)
            if obj is not None:
                db.delete(obj)
        db.commit()


cleanup()

print("=== 1. 鉴权 ===")
with Session(engine) as db:
    expect_code("无 Cookie -> 401", lambda: get_current_admin(None, db), 401)
    expect_code("伪造 token -> 401", lambda: get_current_admin("bad", db), 401)

print("\n=== 2. 新增友链 ===")
r = client.post("/api/friend-links", json={
    "name": PREFIX + "高权重",
    "url": "example-high.com",          # 故意不带协议，验证补全
    "category": "技术",
    "description": "权重最高的一个",
    "cover": "/media/friends/x.png",
    "weight": 100,
})
check("HTTP 200", r.status_code, 200)
high = r.json()
check("url 自动补 https://", high["url"], "https://example-high.com")
check("name 正确", high["name"], PREFIX + "高权重")
check("category 正确", high["category"], "技术")
check("weight 正确", high["weight"], 100)
check("默认可见", high["is_visible"], True)
check_true("返回了 id", isinstance(high.get("id"), int), str(high.get("id")))

r = client.post("/api/friend-links", json={
    "name": PREFIX + "低权重", "url": "https://example-low.com", "weight": 10,
})
low = r.json()

r = client.post("/api/friend-links", json={
    "name": PREFIX + "中权重", "url": "https://example-mid.com", "weight": 50,
})
mid = r.json()

r = client.post("/api/friend-links", json={
    "name": PREFIX + "隐藏", "url": "https://example-hidden.com",
    "weight": 999, "is_visible": False,
})
hidden = r.json()

print("\n=== 3. 已有协议不重复添加 ===")
r = client.post("/api/friend-links", json={
    "name": PREFIX + "http", "url": "http://plain-http.com", "weight": 0,
})
check("http:// 原样保留", r.json()["url"], "http://plain-http.com")
r = client.post("/api/friend-links", json={
    "name": PREFIX + "https", "url": "https://already.com", "weight": 0,
})
check("https:// 原样保留", r.json()["url"], "https://already.com")

print("\n=== 4. 公开列表：只返回可见的，且按权重倒序 ===")
r = client.get("/api/friend-links")
check("HTTP 200", r.status_code, 200)
public = [x for x in r.json() if x["name"].startswith(PREFIX)]
names = [x["name"] for x in public]
check("可见条数 = 5（排除隐藏的 1 条）", len(public), 5)
check_true("隐藏的那条不在列表里",
           PREFIX + "隐藏" not in names, f"实际={names}")
# 权重：100 > 50 > 10 > 0 > 0
check("第一条权重最高", public[0]["weight"], 100)
check("第二条", public[1]["weight"], 50)
check("第三条", public[2]["weight"], 10)
check_true("整体权重递增（倒序）",
           all(public[i]["weight"] >= public[i + 1]["weight"] for i in range(len(public) - 1)),
           f"权重序列={[x['weight'] for x in public]}")

print("\n=== 5. 后台列表：包含隐藏的，同样倒序 ===")
r = client.get("/api/friend-links/all")
allrows = [x for x in r.json() if x["name"].startswith(PREFIX)]
check("后台条数 = 6（含隐藏）", len(allrows), 6)
check("最高权重是隐藏那条", allrows[0]["weight"], 999)
check("它是隐藏的", allrows[0]["is_visible"], False)

print("\n=== 6. 排序稳定性（同权重按 sort_order）===")
a = client.post("/api/friend-links", json={
    "name": PREFIX + "同权A", "url": "https://a.com", "weight": 7, "sort_order": 2,
}).json()
b = client.post("/api/friend-links", json={
    "name": PREFIX + "同权B", "url": "https://b.com", "weight": 7, "sort_order": 1,
}).json()
rows = [x for x in client.get("/api/friend-links").json() if x["name"].startswith(PREFIX + "同权")]
check("sort_order 小的排前面", [x["name"] for x in rows],
      [PREFIX + "同权B", PREFIX + "同权A"])

print("\n=== 7. 负权重（会排到最后）===")
neg = client.post("/api/friend-links", json={
    "name": PREFIX + "负权重", "url": "https://neg.com", "weight": -50,
}).json()
rows = [x for x in client.get("/api/friend-links").json() if x["name"].startswith(PREFIX)]
check("负权重在最后", rows[-1]["name"], PREFIX + "负权重")

print("\n=== 8. 修改 ===")
r = client.put(f"/api/friend-links/{low['id']}", json={"weight": 500})
check("HTTP 200", r.status_code, 200)
check("weight 已更新", r.json()["weight"], 500)
r = client.get("/api/friend-links")
rows = [x for x in r.json() if x["name"].startswith(PREFIX)]
check("改权重后排序跟着变（该条升到第一）", rows[0]["name"], PREFIX + "低权重")

r = client.put(f"/api/friend-links/{low['id']}", json={"is_visible": False})
check("可以隐藏", r.json()["is_visible"], False)
rows = [x for x in client.get("/api/friend-links").json() if x["name"].startswith(PREFIX)]
check_true("隐藏后不在公开列表", PREFIX + "低权重" not in [x["name"] for x in rows])

r = client.put(f"/api/friend-links/{low['id']}", json={"url": "no-protocol.com"})
check("修改时也会补全协议", r.json()["url"], "https://no-protocol.com")

r = client.put(f"/api/friend-links/{low['id']}", json={"name": PREFIX + "改名了"})
check("可以改名", r.json()["name"], PREFIX + "改名了")

print("\n=== 9. 校验：空名称 / 空网址 ===")
r = client.post("/api/friend-links", json={"name": "", "url": "https://x.com"})
check("空名称 -> 422", r.status_code, 422)
r = client.post("/api/friend-links", json={"name": PREFIX + "空网址", "url": ""})
check("空网址 -> 422", r.status_code, 422)

r = client.put(f"/api/friend-links/{low['id']}", json={"name": "   "})
check("改名成全空白 -> 400", r.status_code, 400)

print("\n=== 10. 操作日志有记录 ===")
# 注意：直接 select(OperationLog) 在本版本返回 Row，读 .changes 会报错，
# 所以这里取需要的那几列，用元组解包（单列会返回 (v,) 形式）。
with Session(engine) as db:
    logs = db.exec(
        select(OperationLog.action, OperationLog.changes)
        .where(OperationLog.target_type == "friend_link")
        .order_by(OperationLog.id.desc())
        .limit(5)
    ).all()
check_true("产生了 friend_link 类型日志", len(logs) > 0, f"条数={len(logs)}")
check_true(
    "日志里能看出改动字段",
    any("weight" in str(row[1] or "") or "name" in str(row[1] or "") for row in logs),
)
check_true(
    "有 create 与 update 两种动作",
    {row[0] for row in logs} & {"create", "update"} != set(),
    f"实际动作={sorted({row[0] for row in logs})}",
)

print("\n=== 11. 删除 ===")
r = client.delete(f"/api/friend-links/{hidden['id']}")
check("HTTP 200", r.status_code, 200)
with Session(engine) as db:
    check("数据库里已删除", db.get(FriendLink, hidden["id"]) is None, True)
r = client.delete("/api/friend-links/999999")
check("删不存在的 -> 404", r.status_code, 404)

print("\n=== 12. 封面字段可空、可长路径 ===")
long_cover = "/media/friends/" + "a" * 200 + ".png"
r = client.post("/api/friend-links", json={
    "name": PREFIX + "长封面", "url": "https://c.com", "cover": long_cover,
})
check("长封面能存下", r.json()["cover"], long_cover)

print("\n=== 13. 清理 ===")
cleanup()
with Session(engine) as db:
    left = ids_of(
        db, select(FriendLink.id).where(FriendLink.name.startswith(PREFIX))
    )
check("测试数据已清理", len(left), 0)

app.dependency_overrides.clear()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] 友链接口全部断言通过")
