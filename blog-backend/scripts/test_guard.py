"""测试脚本的安全护栏。

背景：这些测试脚本是**独立脚本**（不是 pytest），默认连的是
`blog-backend/.env` 里的那个库 —— 也就是生产库 `personal_blog`。
虽然每个脚本都只清自己造的数据（按测试用的 login / id），但一旦
清理逻辑写错，就会误删真实数据；而且"在生产库上跑会删数据的脚本"
本身就是个危险习惯。

这里加一道显式确认：
  · 连的是"测试库"（库名含 test）→ 直接放行
  · 连的是其它库（含生产库）→ 默认**拒绝**，除非显式允许
      · 命令行加 --allow-production-db
      · 或环境变量 ALLOW_TEST_ON_PRODUCTION=1

用法（在脚本最前面调用一次）：
    from _test_guard import guard
    guard()
"""
import os
import sys


def _db_name() -> str:
    """从 DATABASE_URL 里取出库名"""
    from app.config import settings

    url = settings.DATABASE_URL or ""
    # mysql+pymysql://user:pass@host:port/dbname?charset=...
    tail = url.rsplit("/", 1)[-1]
    return tail.split("?", 1)[0]


def guard(script_name: str | None = None) -> None:
    name = script_name or (sys.argv[0] if sys.argv else "test")
    dbname = _db_name()
    is_test_db = "test" in dbname.lower()
    allowed = (
        "--allow-production-db" in sys.argv
        or os.getenv("ALLOW_TEST_ON_PRODUCTION") == "1"
    )

    if is_test_db:
        return

    if allowed:
        print(
            f"[护栏] 注意：正在 **{dbname}** 这个非测试库上运行 {name}。"
            "脚本会清理自己造的数据（按测试 login / id），但请确认库选对了。\n"
        )
        return

    print("=" * 68)
    print(f"  已阻止：{name} 将要在一个非测试库上写入并清理数据")
    print(f"  目标库：{dbname}")
    print("=" * 68)
    print()
    print("  这些测试脚本会插入并删除数据。虽然只删自己造的那部分，")
    print("  但为了避免误删真实数据，默认不允许在非测试库上运行。")
    print()
    print("  推荐做法：准备一个测试库，例如")
    print("      CREATE DATABASE personal_blog_test "
          "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
    print("   然后运行测试时临时覆盖连接串：")
    print("      $env:DATABASE_URL='mysql+pymysql://用户:密码@localhost:3306/"
          "personal_blog_test?charset=utf8mb4'")
    print(f"      python blog-backend/scripts/{name}")
    print()
    print("  确实想在当前库上跑（例如本地开发库，无所谓数据）：")
    print(f"      python blog-backend/scripts/{name} --allow-production-db")
    print("      或设置环境变量 ALLOW_TEST_ON_PRODUCTION=1")
    print("=" * 68)
    sys.exit(2)


# ============================================================
# 数据库查询辅助
# ============================================================

def _unwrap(v):
    """把查询结果 unwrap 成标量（兼容多种返回形态）。

    本项目的 SQLModel 版本在不同写法下会返回不同东西，实测：
        db.exec(select(Admin)).first()     -> Row（不是 Admin 实例）
        db.exec(select(Admin.id)).first()  -> Row，形如 (1,)
        db.exec(select(Admin.id)).one_or_none() -> ScalarResult（没有 .scalars()）
    为了避免依赖具体形态，这里统一处理：
        None / 标量      -> 原样返回
        单元素 tuple/Row -> 取第 0 个
    """
    if v is None:
        return None
    if isinstance(v, (int, str, float, bool)):
        return v
    try:
        if len(v) == 1:          # tuple / Row / list
            return v[0]
    except TypeError:
        pass
    return v


def admin_id_of(db, AdminModel) -> int | None:
    """取第一个管理员的 id（一定返回标量 int 或 None）。

    背景：这个项目的 SQLModel/SQLAlchemy 组合下，
    `db.exec(select(Admin.id)).first()` 拿到的是 Row 而不是 int，
    直接当 admin_id 用会往数据库里写 (1,) 这种值（MySQL 报 1366）。
    """
    from sqlmodel import select

    return _unwrap(db.exec(select(AdminModel.id)).first())


def ids_of(db, stmt) -> list:
    """执行"只查主键"的语句并返回 id 列表（每项都是标量）。

    用它是为了安全地删除：`db.exec(select(Model)).all()` 返回 Row，
    Row 不是映射对象，直接 db.delete(row) 会抛 UnmappedInstanceError。
    """
    out = []
    for row in db.exec(stmt).all():
        v = _unwrap(row)
        if v is not None:
            out.append(v)
    return out


