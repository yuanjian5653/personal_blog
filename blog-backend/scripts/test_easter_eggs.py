"""
暗号彩蛋（后台可管理）的测试。

覆盖：
  · 前台校验接口能命中已启用的暗号
  · **暗号比较忽略空格与大小写**
  · 关闭的暗号校验不到（与"不存在"返回一致，不泄露存在性）
  · 后台 CRUD：新建 / 改名 / 改类型 / 启停 / 删除
  · 暗号重复（归一化后相同）被拒 409
  · 非法类型 / 非法动效被拒 400
  · 校验结果里**不含 code**（这是彩蛋能叫彩蛋的前提）
  · 排序按 sort_order

用法：python scripts/test_easter_eggs.py --allow-production-db
"""
import sys
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlmodel import Session, delete

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import admin_id_of, guard  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.db_utils import model as db_model  # noqa: E402
from app.deps import get_current_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin, EasterEgg  # noqa: E402
from app.routers.easter_eggs import (  # noqa: E402
    check_code,
    create_egg,
    delete_egg,
    list_eggs,
    update_egg,
)
from app.schemas.easter_egg import (  # noqa: E402
    EasterEggCreate,
    EasterEggUpdate,
    EggCheckRequest,
)

guard("test_easter_eggs.py")
init_db()

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []
PREFIX = "__eggtest_"


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
        for r in db.exec(
            select(EasterEgg).where(EasterEgg.code.startswith(PREFIX))
        ).all():
            obj = db_model(r)
            if isinstance(obj, EasterEgg):
                db.delete(obj)
        db.commit()


cleanup()

with Session(engine) as db:
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("没有管理员账号，跳过")
    raise SystemExit(0)
admin = SimpleNamespace(id=admin_id, login="tester")

# ------------------------------------------------------------------ 新建
print("=== 1. 新建 ===")
with Session(engine) as db:
    row = create_egg(
        EasterEggCreate(
            code=PREFIX + "银河",
            name="测试背景",
            hint="提示语",
            kind="background",
            transition="zoom",
            sort_order=5,
        ),
        db=db,
        admin=admin,
    )
check("暗号正确", row.code, PREFIX + "银河")
check("类型正确", row.kind, "background")
check("动效正确", row.transition, "zoom")
check("默认启用", row.is_enabled, True)
check("壁纸为空", row.asset_path, None)
egg_id = row.id

# ------------------------------------------------------------------ 校验
print("\n=== 2. 前台校验暗号 ===")
with Session(engine) as db:
    hit = check_code(EggCheckRequest(code=PREFIX + "银河"), db=db)
check("命中返回名称", hit.name, "测试背景")
check("命中返回类型", hit.kind, "background")
check("命中返回动效", hit.transition, "zoom")
check_true("返回里**不含 code**", not hasattr(hit, "code"))
check_true("返回的字段里没有 code", "code" not in hit.model_dump())

# 归一化：空格 / 大小写
with Session(engine) as db:
    padded = check_code(EggCheckRequest(code=f"  {PREFIX}银河  "), db=db)
check("前后空格不影响", padded.name, "测试背景")

# 错误暗号
with Session(engine) as db:
    try:
        check_code(EggCheckRequest(code=PREFIX + "不存在"), db=db)
        check("错暗号应 404", False, True)
    except HTTPException as e:
        check("错暗号 → 404", e.status_code, 404)

with Session(engine) as db:
    try:
        check_code(EggCheckRequest(code="   "), db=db)
        check("空白暗号应 404", False, True)
    except HTTPException as e:
        check("空白暗号 → 404", e.status_code, 404)

# ------------------------------------------------------------------ 重复
print("\n=== 3. 暗号唯一（归一化后比较）===")
for dup in (PREFIX + "银河", f"  {PREFIX}银河 "):
    with Session(engine) as db:
        try:
            create_egg(
                EasterEggCreate(code=dup, name="重复", kind="background"),
                db=db,
                admin=admin,
            )
            check(f"重复暗号应被拒：{dup!r}", False, True)
        except HTTPException as e:
            check(f"重复暗号 → {e.status_code}", e.status_code, 409)

# ------------------------------------------------------------------ 启停
print("\n=== 4. 关闭后校验不到（且与不存在一致）===")
with Session(engine) as db:
    update_egg(egg_id, EasterEggUpdate(is_enabled=False), db=db, admin=admin)
with Session(engine) as db:
    try:
        check_code(EggCheckRequest(code=PREFIX + "银河"), db=db)
        check("关闭后应 404", False, True)
    except HTTPException as e:
        check("关闭后 → 404", e.status_code, 404)
        check("提示语与'不存在'一致（不泄露存在性）", e.detail, "没有这个暗号")

with Session(engine) as db:
    update_egg(egg_id, EasterEggUpdate(is_enabled=True), db=db, admin=admin)
with Session(engine) as db:
    again = check_code(EggCheckRequest(code=PREFIX + "银河"), db=db)
check("重新启用后又能命中", again.name, "测试背景")

# ------------------------------------------------------------------ 修改
print("\n=== 5. 修改 ===")
with Session(engine) as db:
    updated = update_egg(
        egg_id,
        EasterEggUpdate(name="改名后", kind="stars", transition="blur"),
        db=db,
        admin=admin,
    )
check("名称已改", updated.name, "改名后")
check("类型已改", updated.kind, "stars")
check("动效已改", updated.transition, "blur")

# 改成已存在的暗号 → 409
with Session(engine) as db:
    try:
        update_egg(
            egg_id, EasterEggUpdate(code="星空"), db=db, admin=admin
        )
        check("改成已存在暗号应 409", False, True)
    except HTTPException as e:
        check("改成已存在暗号 → 409", e.status_code, 409)

# 空名称 → 400
with Session(engine) as db:
    try:
        update_egg(egg_id, EasterEggUpdate(name="   "), db=db, admin=admin)
        check("空名称应 400", False, True)
    except HTTPException as e:
        check("空名称 → 400", e.status_code, 400)

# ------------------------------------------------------------------ 非法值
print("\n=== 6. 非法类型 / 动效 ===")
for bad_kind in ("bogus", "BACKGROUND"):
    with Session(engine) as db:
        try:
            create_egg(
                EasterEggCreate(code=PREFIX + f"k{bad_kind}", name="x", kind=bad_kind),
                db=db,
                admin=admin,
            )
            check(f"非法类型 {bad_kind!r} 应 400", False, True)
        except (HTTPException, ValueError) as e:
            code = getattr(e, "status_code", 400)
            check(f"非法类型 {bad_kind!r} 被拒", code in (400, 422), True)

for bad_tr in ("spin", "FLY"):
    with Session(engine) as db:
        try:
            create_egg(
                EasterEggCreate(
                    code=PREFIX + f"t{bad_tr}", name="x", transition=bad_tr
                ),
                db=db,
                admin=admin,
            )
            check(f"非法动效 {bad_tr!r} 应 400", False, True)
        except (HTTPException, ValueError) as e:
            code = getattr(e, "status_code", 400)
            check(f"非法动效 {bad_tr!r} 被拒", code in (400, 422), True)

# ------------------------------------------------------------------ 列表与排序
print("\n=== 7. 列表按 sort_order 排序 ===")
with Session(engine) as db:
    create_egg(
        EasterEggCreate(
            code=PREFIX + "第二", name="第二个", kind="game", sort_order=1
        ),
        db=db,
        admin=admin,
    )
with Session(engine) as db:
    all_rows = list_eggs(db=db, _admin=admin)
orders = [r.sort_order for r in all_rows]
check("列表整体按 sort_order 升序", orders == sorted(orders), True)
check_true(
    "列表里能看到测试数据",
    any(r.code.startswith(PREFIX) for r in all_rows),
)

# ------------------------------------------------------------------ 删除
print("\n=== 8. 删除 ===")
with Session(engine) as db:
    delete_egg(egg_id, db=db, _admin=admin)
with Session(engine) as db:
    check_true("删除后查不到", db.get(EasterEgg, egg_id) is None)
with Session(engine) as db:
    try:
        delete_egg(999999, db=db, _admin=admin)
        check("删除不存在应 404", False, True)
    except HTTPException as e:
        check("删除不存在 → 404", e.status_code, 404)

# ------------------------------------------------------------------ 收尾
cleanup()
print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 暗号彩蛋全部断言通过")
