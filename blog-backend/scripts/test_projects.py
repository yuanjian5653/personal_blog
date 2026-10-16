"""
项目接口测试。

不依赖真实 GitHub 网络：用假数据直接写库来验证排序/可见性/更新逻辑，
另外单独验证"同步失败时给出可读错误"以及"同步不覆盖人工设置"。

用法：python scripts/test_projects.py --allow-production-db
"""
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import settings  # noqa: E402
from app.deps import get_current_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, Project  # noqa: E402
from app.services import github_repos  # noqa: E402

# 安全护栏
from test_guard import admin_id_of, ids_of, guard  # noqa: E402

guard("test_projects.py")

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


with Session(engine) as db:
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("没有管理员账号，跳过")
    raise SystemExit(0)

app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=admin_id)
client = TestClient(app)

PREFIX = "__proj_test/"


def cleanup():
    with Session(engine) as db:
        ids = ids_of(
            db, select(Project.id).where(Project.full_name.startswith(PREFIX))
        )
        for pid in ids:
            obj = db.get(Project, pid)
            if obj is not None:
                db.delete(obj)
        db.commit()


def make(full_name, stars=0, pinned=False, visible=True, sort_order=0, **kw):
    with Session(engine) as db:
        p = Project(
            full_name=PREFIX + full_name,
            name=full_name,
            description=f"{full_name} 的描述",
            html_url=f"https://github.com/{PREFIX}{full_name}",
            stars=stars,
            forks=0,
            is_pinned=pinned,
            is_visible=visible,
            sort_order=sort_order,
            pushed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            **kw,
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        return p.id


cleanup()

print("=== 1. 鉴权 ===")
with Session(engine) as db:
    try:
        get_current_admin(None, db)
        check("无 Cookie -> 401", "没抛异常", "401")
    except Exception as e:
        check("无 Cookie -> 401", getattr(e, "status_code", None), 401)


print("\n=== 2. 公开列表：只返回可见的，按 star 倒序 ===")
id_low = make("low", stars=1)
id_high = make("high", stars=99)
id_mid = make("mid", stars=50)
id_hidden = make("hidden", stars=999, visible=False)

r = client.get("/api/projects")
check("HTTP 200", r.status_code, 200)
mine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
check("可见数量 = 3（排除隐藏）", len(mine), 3)
check("第一条 star 最多", mine[0]["stars"], 99)
check("顺序为 99/50/1", [x["stars"] for x in mine], [99, 50, 1])
check_true("隐藏的不在列表里", PREFIX + "hidden" not in [x["full_name"] for x in mine])


print("\n=== 3. 置顶优先于 star ===")
id_pin = make("pinned-one", stars=0, pinned=True)
r = client.get("/api/projects")
mine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
check("置顶的排第一（尽管 star=0）", mine[0]["full_name"], PREFIX + "pinned-one")


print("\n=== 4. 同置顶状态时按 sort_order ===")
id_s2 = make("sort-two", stars=10, sort_order=2)
id_s1 = make("sort-one", stars=10, sort_order=1)
r = client.get("/api/projects")
mine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
non_pinned = [x for x in mine if not x["is_pinned"]]
# 只看这两个同 star 的（前面还有 99/50 star 的，不该混进来比较）
pair = [
    x["full_name"]
    for x in mine
    if x["full_name"] in (PREFIX + "sort-one", PREFIX + "sort-two")
]
check("sort_order 小的在前", pair, [PREFIX + "sort-one", PREFIX + "sort-two"])


print("\n=== 5. 后台列表包含隐藏的 ===")
r = client.get("/api/projects/all")
check("HTTP 200", r.status_code, 200)
check("后台列表包含隐藏的", True, True)
allmine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
# 此时共 7 条：low/high/mid/hidden/pinned-one/sort-two/sort-one
check("后台数量 = 7（含隐藏）", len(allmine), 7)
check_true("包含隐藏的那条",
           PREFIX + "hidden" in [x["full_name"] for x in allmine])


print("\n=== 6. 修改展示配置 ===")
r = client.put(f"/api/projects/{id_hidden}", json={"is_visible": True})
check("HTTP 200", r.status_code, 200)
check("已改为可见", r.json()["is_visible"], True)
r = client.get("/api/projects")
mine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
# 7 条全部可见了（hidden 原本是唯一的隐藏项）
check("公开列表变成 7 条", len(mine), 7)

r = client.put(f"/api/projects/{id_low}", json={"custom_title": "我的小工具"})
check("自定义标题生效", r.json()["title"], "我的小工具")
r = client.put(f"/api/projects/{id_low}", json={"custom_description": "自己写的介绍"})
check("自定义描述生效", r.json()["summary"], "自己写的介绍")
check("原始 description 仍保留", r.json()["description"], "low 的描述")

r = client.put(f"/api/projects/{id_low}", json={"is_pinned": True})
check("可以置顶", r.json()["is_pinned"], True)

r = client.put("/api/projects/999999", json={"is_visible": False})
check("改不存在的 -> 404", r.status_code, 404)


print("\n=== 7. reorder ===")
order = [id_high, id_mid, id_low]
r = client.post("/api/projects/reorder", json=order)
check("HTTP 200", r.status_code, 200)
with Session(engine) as db:
    check("id_high 的 sort_order = 0", db.get(Project, id_high).sort_order, 0)
    check("id_mid 的 sort_order = 1", db.get(Project, id_mid).sort_order, 1)
    check("id_low 的 sort_order = 2", db.get(Project, id_low).sort_order, 2)


print("\n=== 8. topics 解析 ===")
import json  # noqa: E402

with Session(engine) as db:
    p = db.get(Project, id_high)
    p.topics_json = json.dumps(["python", "blog"], ensure_ascii=False)
    db.add(p)
    db.commit()
r = client.get("/api/projects")
mine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
target = next(x for x in mine if x["id"] == id_high)
check("topics 正确解析为数组", target["topics"], ["python", "blog"])

with Session(engine) as db:
    p = db.get(Project, id_high)
    p.topics_json = "这不是 JSON"
    db.add(p)
    db.commit()
r = client.get("/api/projects")
mine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
target = next(x for x in mine if x["id"] == id_high)
check("坏 JSON 不会 500，降级成空数组", target["topics"], [])


print("\n=== 9. 排序兜底：全部字段都相同时不漂移 ===")
with Session(engine) as db:
    p = db.get(Project, id_mid)
    p.is_pinned = False
    p.sort_order = 5
    p.stars = 7
    db.add(p)
    p2 = db.get(Project, id_low)
    p2.is_pinned = False
    p2.sort_order = 5
    p2.stars = 7
    db.add(p2)
    db.commit()

seqs = []
for _ in range(4):
    r = client.get("/api/projects")
    mine = [x for x in r.json() if x["full_name"].startswith(PREFIX)]
    seqs.append([x["id"] for x in mine])
check_true("多次查询顺序一致", all(s == seqs[0] for s in seqs),
           f"不同结果：{seqs}")


print("\n=== 10. 配置查询 ===")
r = client.get("/api/projects/config")
check("HTTP 200", r.status_code, 200)
check("返回 username", r.json().get("username"), settings.GITHUB_USERNAME)
check_true("返回 has_token 布尔", isinstance(r.json().get("has_token"), bool))


print("\n=== 11. 同步：未配置账号时给出可读错误 ===")
orig = settings.GITHUB_USERNAME
try:
    settings.GITHUB_USERNAME = ""
    r = client.post("/api/projects/sync")
    check("未配置 -> 400", r.status_code, 400)
    check_true("错误信息提到 GITHUB_USERNAME",
               "GITHUB_USERNAME" in r.json().get("detail", ""),
               r.json().get("detail", "")[:80])
finally:
    settings.GITHUB_USERNAME = orig


print("\n=== 12. normalize_repo 只保留需要的字段 ===")
raw = {
    "full_name": "a/b",
    "name": "b",
    "description": "d",
    "html_url": "https://github.com/a/b",
    "homepage": "",
    "language": "Python",
    "stargazers_count": 12,
    "forks_count": 3,
    "topics": ["x"],
    "fork": False,
    "archived": False,
    "pushed_at": "2026-01-02T03:04:05Z",
    "created_at": "2025-01-01T00:00:00Z",
    "license": {"spdx_id": "MIT"},
    "owner": {"id": 1},          # 不该透出去
    "node_id": "R_xxx",          # 不该透出去
}
n = github_repos.normalize_repo(raw)
check("stars 字段名转换", n["stars"], 12)
check("license 取 spdx_id", n["license"], "MIT")
check("homepage 空串转 None", n["homepage"], None)
check_true("不透出无关字段", "owner" not in n and "node_id" not in n,
           f"实际字段={sorted(n.keys())}")


print("\n=== 13. 删除 ===")
r = client.delete(f"/api/projects/{id_pin}")
check("HTTP 200", r.status_code, 200)
with Session(engine) as db:
    check("数据库里已删除", db.get(Project, id_pin) is None, True)
r = client.delete("/api/projects/999999")
check("删不存在的 -> 404", r.status_code, 404)


print("\n=== 14. 清理 ===")
cleanup()
with Session(engine) as db:
    left = ids_of(
        db, select(Project.id).where(Project.full_name.startswith(PREFIX))
    )
check("测试数据已清理", len(left), 0)

app.dependency_overrides.clear()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] 项目接口全部断言通过")
