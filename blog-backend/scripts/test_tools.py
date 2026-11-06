"""
工具接口测试。

覆盖：
  · 公开列表只返回已上架的
  · 新建：slug 自动生成 tool-{id} / 自定义 slug / slug 重复
  · kind 与 href 的一致性校验（link 必须 http、page 必须 / 开头）
  · 排序：新工具排在最后、reorder 批量调整
  · 更新：只改一个字段、改 kind 时校验 href、清空 slug 回退
  · 上下架、点击计数、删除、鉴权

用法：python scripts/test_tools.py --allow-production-db
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
from app.models import Admin, Tool  # noqa: E402

guard("test_tools.py")

# 生产环境里 tools 表由 lifespan 的 init_db() 创建；
# 测试直接建 client 不走 lifespan，所以这里显式建一次（只建缺失的表）。
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
        FAILS.append(f"{label}: status={resp.status_code} want={want} body={resp.text[:200]}")
        print(f"          body={resp.text[:200]}")


with Session(engine) as db:
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("没有管理员账号，跳过")
    raise SystemExit(0)

app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=admin_id)
client = TestClient(app)

PREFIX = "__tool_test_"


def cleanup():
    """只删本次测试造的数据（按 name 前缀）"""
    with Session(engine) as db:
        ids = ids_of(db, select(Tool.id).where(Tool.name.startswith(PREFIX)))
        for tid in ids:
            obj = db.get(Tool, tid)
            if obj is not None:
                db.delete(obj)
        db.commit()


cleanup()

# ---------------------------------------------------------------- 鉴权
print("=== 1. 鉴权 ===")
with Session(engine) as db:
    try:
        get_current_admin(None, db)
        print("  [FAIL] 无 Cookie 应 401")
        FAILS.append("鉴权：无 Cookie 没有 401")
    except Exception as e:
        check("无 Cookie -> 401", getattr(e, "status_code", None), 401)

# ---------------------------------------------------------------- 新建
print("\n=== 2. 新建 ===")
r = client.post("/api/tools", json={
    "name": PREFIX + "甲工具",
    "href": "https://example.com/a",
    "kind": "link",
    "summary": "第一个",
    "category": "视频",
    "icon": "Wrench",
    "tags": "测试, 甲",
})
check_status("新建成功", r, 200)
tool_a = r.json()
check("slug 自动生成", tool_a["slug"], f"tool-{tool_a['id']}")
check("name 正确", tool_a["name"], PREFIX + "甲工具")
check("kind 正确", tool_a["kind"], "link")
check("category 正确", tool_a["category"], "视频")
check("icon 正确", tool_a["icon"], "Wrench")
check("tags 正确", tool_a["tags"], "测试, 甲")
check("默认上架", tool_a["is_visible"], True)
check("初始点击数为 0", tool_a["click_count"], 0)
check_true("返回 id", isinstance(tool_a.get("id"), int), str(tool_a.get("id")))

# 自定义 slug
r = client.post("/api/tools", json={
    "name": PREFIX + "乙工具",
    "slug": "my-custom-slug",
    "href": "/projects",
    "kind": "page",
})
check_status("自定义 slug 新建成功", r, 200)
tool_b = r.json()
check("自定义 slug 生效", tool_b["slug"], "my-custom-slug")

# slug 重复
r = client.post("/api/tools", json={
    "name": PREFIX + "重复",
    "slug": "my-custom-slug",
    "href": "https://example.com/dup",
    "kind": "link",
})
check_status("slug 重复 -> 400", r, 400)

# slug 非法字符
r = client.post("/api/tools", json={
    "name": PREFIX + "非法",
    "slug": "中文标识",
    "href": "https://example.com/x",
    "kind": "link",
})
check_status("slug 含中文 -> 400", r, 400)

# ---------------------------------------------------------------- kind/href 校验
print("\n=== 3. kind 与 href 一致性 ===")
r = client.post("/api/tools", json={
    "name": PREFIX + "坏外链", "href": "example.com", "kind": "link",
})
check_status("link 不带协议 -> 400", r, 400)

r = client.post("/api/tools", json={
    "name": PREFIX + "坏站内", "href": "https://example.com", "kind": "page",
})
check_status("page 不是 / 开头 -> 400", r, 400)

r = client.post("/api/tools", json={
    "name": PREFIX + "站内好", "href": "/friends", "kind": "page",
})
check_status("page 用 / 开头 -> 200", r, 200)
tool_page = r.json()

r = client.post("/api/tools", json={
    "name": PREFIX + "下载甲", "href": "/media/tools/a.exe", "kind": "app",
})
check_status("app 用站内路径 -> 200", r, 200)
tool_app = r.json()

r = client.post("/api/tools", json={
    "name": PREFIX + "下载乙", "href": "https://cdn.example.com/a.zip", "kind": "app",
})
check_status("app 用外链 -> 200", r, 200)

r = client.post("/api/tools", json={
    "name": PREFIX + "非法类型", "href": "/x", "kind": "weird",
})
check_status("非法 kind -> 422", r, 422)

# ---------------------------------------------------------------- 排序
print("\n=== 4. 排序 ===")
r = client.get("/api/tools/all")
check_status("后台列表", r, 200)
rows = r.json()
mine = [t for t in rows if t["name"].startswith(PREFIX)]
orders = [t["sort_order"] for t in mine]
check_true("新工具 sort_order 递增（排在最后）", orders == sorted(orders), str(orders))
check_true("前缀数据都在", len(mine) >= 5, str(len(mine)))

# reorder：把甲工具提到最前
targets = sorted(mine, key=lambda t: t["id"])
body = [{"id": t["id"], "sort_order": i} for i, t in enumerate(targets)]
r = client.post("/api/tools/reorder", json=body)
check_status("reorder", r, 200)

r = client.get("/api/tools/all")
rows = r.json()
mine = [t for t in rows if t["name"].startswith(PREFIX)]
check_true(
    "reorder 后顺序符合预期",
    [t["id"] for t in mine] == [t["id"] for t in targets],
    f"{[t['id'] for t in mine]} vs {[t['id'] for t in targets]}",
)

# ---------------------------------------------------------------- 更新
print("\n=== 5. 更新 ===")
r = client.put(f"/api/tools/{tool_a['id']}", json={"summary": "改过的说明"})
check_status("只改 summary", r, 200)
updated = r.json()
check("summary 已更新", updated["summary"], "改过的说明")
check("name 未受影响", updated["name"], PREFIX + "甲工具")
check("href 未受影响", updated["href"], "https://example.com/a")

# 改 kind 但不改 href → 用旧 href 校验，应失败（旧值不以 / 开头）
r = client.put(f"/api/tools/{tool_a['id']}", json={"kind": "page"})
check_status("改 kind 但旧 href 不合法 -> 400", r, 400)

# 同时改 kind 和 href → 成功
r = client.put(
    f"/api/tools/{tool_a['id']}",
    json={"kind": "page", "href": "/tools/x"},
)
check_status("kind+href 一起改 -> 200", r, 200)
check("kind 已更新", r.json()["kind"], "page")

# 清空 slug → 回退 tool-{id}
r = client.put(f"/api/tools/{tool_b['id']}", json={"slug": ""})
check_status("清空 slug", r, 200)
check("slug 回退", r.json()["slug"], f"tool-{tool_b['id']}")

# ---------------------------------------------------------------- 配色
print("\n=== 5b. 强调色（预设白名单）===")
# 新建时不传 → None
check("未设置时 color 为 None", tool_a.get("color"), None)

# 合法预设
r = client.put(f"/api/tools/{tool_a['id']}", json={"color": "amber"})
check_status("设为 amber", r, 200)
check("color 已是 amber", r.json()["color"], "amber")

# 大小写与空格归一
r = client.put(f"/api/tools/{tool_a['id']}", json={"color": "  MINT  "})
check_status("大小写/空格归一", r, 200)
check("归一成小写 mint", r.json()["color"], "mint")

# "default" 表示跟随主题 → 存 None
r = client.put(f"/api/tools/{tool_a['id']}", json={"color": "default"})
check_status("default 归为 None", r, 200)
check("default 存成 None", r.json()["color"], None)

# 空串也存 None
client.put(f"/api/tools/{tool_a['id']}", json={"color": "sky"})
r = client.put(f"/api/tools/{tool_a['id']}", json={"color": ""})
check("空串存成 None", r.json()["color"], None)

# 非白名单值必须被拒（防止自由色值 / 样式注入）
#
# 两种拒绝方式都算正确：
#   · 不在白名单 → 路由里 normalize_tool_color 抛 ValueError → 400
#   · 超过字段 max_length=20 → pydantic 在进路由之前就拦掉 → 422
# 所以这里断言"被拒"，而不是写死某一个状态码。
for bad in ("#ff0000", "red", "red; background:url(x)", "<script>"):
    r = client.put(f"/api/tools/{tool_a['id']}", json={"color": bad})
    ok = r.status_code in (400, 422)
    print(f"  [{'OK ' if ok else 'FAIL'}] 非法配色 {bad!r} 被拒 (HTTP {r.status_code})")
    if not ok:
        FAILS.append(f"非法配色 {bad!r} 未被拒绝：{r.status_code}")

# 新建时也可以直接带配色
r = client.post("/api/tools", json={
    "name": PREFIX + "配色工具",
    "href": "/subscribe",
    "kind": "page",
    "color": "violet",
})
check_status("新建带配色", r, 200)
tool_color = r.json()
check("新建的 color 是 violet", tool_color["color"], "violet")

# 列表接口也要返回 color（前端列表靠它上色）
r = client.get("/api/tools")
row = next((x for x in r.json() if x["id"] == tool_color["id"]), None)
check_true("列表响应含 color", row is not None and row.get("color") == "violet")

# 详情接口也带 color
r = client.get(f"/api/tools/{tool_color['id']}")
check("详情响应含 color", r.json()["color"], "violet")

# 白名单与后端常量一致
from app.schemas.tool import TOOL_COLORS as _TC  # noqa: E402
check_true("TOOL_COLORS 含 default", "default" in _TC, str(_TC))
check_true("TOOL_COLORS 至少 6 种颜色", len(_TC) >= 6, str(len(_TC)))

client.delete(f"/api/tools/{tool_color['id']}")

# ---------------------------------------------------------------- 上下架 + 点击
print("\n=== 6. 上下架与点击 ===")
r = client.get("/api/tools")
before = [t for t in r.json() if t["name"].startswith(PREFIX)]
check_true("公开列表能看到上架的", len(before) >= 4, str(len(before)))

r = client.put(f"/api/tools/{tool_page['id']}", json={"is_visible": False})
check_status("下架", r, 200)

r = client.get("/api/tools")
public = [t for t in r.json() if t["name"].startswith(PREFIX)]
check_true(
    "下架后公开列表看不到",
    all(t["id"] != tool_page["id"] for t in public),
    str([t["id"] for t in public]),
)

r = client.get("/api/tools/all")
admin_rows = [t for t in r.json() if t["name"].startswith(PREFIX)]
check_true(
    "后台列表仍能看到下架的",
    any(t["id"] == tool_page["id"] for t in admin_rows),
)

# 点击计数
r = client.post(f"/api/tools/{tool_app['id']}/click")
check_status("点击上报", r, 200)
r = client.post(f"/api/tools/{tool_app['id']}/click")
r = client.get("/api/tools/all")
row = next(t for t in r.json() if t["id"] == tool_app["id"])
check("click_count 累加到 2", row["click_count"], 2)

r = client.post("/api/tools/999999/click")
check_status("点击不存在的工具 -> 404", r, 404)

# ---------------------------------------------------------------- 删除
print("\n=== 7. 删除 ===")
r = client.delete(f"/api/tools/{tool_b['id']}")
check_status("删除", r, 200)
r = client.get(f"/api/tools/{tool_b['id']}")
check_status("删除后查不到", r, 404)
r = client.delete("/api/tools/999999")
check_status("删除不存在 -> 404", r, 404)

# ---------------------------------------------------------------- 详情页（description + by-slug）
print("\n=== 8. 详情页 ===")
r = client.post("/api/tools", json={
    "name": PREFIX + "带正文",
    "slug": "with-desc-tool",
    "href": "/downloads/x.zip",
    "kind": "app",
    "description": "# 说明\n\n这是一段**Markdown** 正文。",
})
check_status("带 description 新建", r, 200)
tool_desc = r.json()

# 列表接口不返回正文（响应体积）
r = client.get("/api/tools")
check_status("公开列表", r, 200)
rows = r.json()
check_true(
    "列表项不含 description 字段",
    all("description" not in t for t in rows),
    str([k for t in rows for k in t if k == "description"][:3]),
)

r = client.get("/api/tools/all")
check_true(
    "后台列表也不含 description",
    all("description" not in t for t in r.json()),
)

# 详情接口含正文
r = client.get(f"/api/tools/{tool_desc['id']}")
check_status("后台单条", r, 200)
detail = r.json()
check_true("详情含 description 字段", "description" in detail)
check_true(
    "正文内容正确",
    detail["description"].startswith("# 说明"),
    repr(detail.get("description"))[:60],
)

# by-slug 公开详情
r = client.get("/api/tools/by-slug/with-desc-tool")
check_status("by-slug 详情", r, 200)
by_slug = r.json()
check("by-slug 命中同一条", by_slug["id"], tool_desc["id"])
check_true("by-slug 也带正文", bool(by_slug.get("description")))

r = client.get("/api/tools/by-slug/不存在-slug")
check_status("by-slug 不存在 -> 404", r, 404)

# 下架后 by-slug 不可访问（不泄露草稿）
client.put(f"/api/tools/{tool_desc['id']}", json={"is_visible": False})
r = client.get("/api/tools/by-slug/with-desc-tool")
check_status("下架后 by-slug -> 404", r, 404)
client.put(f"/api/tools/{tool_desc['id']}", json={"is_visible": True})

# 更新正文
r = client.put(
    f"/api/tools/{tool_desc['id']}",
    json={"description": "改过的正文"},
)
check_status("更新正文", r, 200)
r = client.get(f"/api/tools/{tool_desc['id']}")
check("正文已更新", r.json()["description"], "改过的正文")

# 清空正文 → None
r = client.put(f"/api/tools/{tool_desc['id']}", json={"description": ""})
check_status("清空正文", r, 200)
r = client.get(f"/api/tools/{tool_desc['id']}")
check("清空后为 None", r.json()["description"], None)

# ---------------------------------------------------------------- 收尾
cleanup()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 工具接口全部断言通过")
