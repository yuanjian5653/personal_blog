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
