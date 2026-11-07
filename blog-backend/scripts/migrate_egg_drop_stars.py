"""
把历史数据里 kind='stars' 的彩蛋改成 'background'。

背景：内置星空效果已被删除，kind 只剩 background / game。
旧数据里可能还留着 stars，会让后台下拉显示一个不存在���选项。

幂等：没有 stars 行时什么都不做。

用法：
    python scripts/migrate_egg_drop_stars.py --dry-run
    python scripts/migrate_egg_drop_stars.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    if "easter_eggs" not in inspect(engine).get_table_names():
        print("  easter_eggs 表不存在，跳过")
        return 0

    with engine.connect() as conn:
        n = conn.execute(
            text("SELECT COUNT(*) FROM easter_eggs WHERE kind = 'stars'")
        ).scalar()

    print(f"  kind='stars' 的行数: {n}")
    if not n:
        print("  无需迁移")
        return 0

    sql = "UPDATE easter_eggs SET kind = 'background' WHERE kind = 'stars'"
    print("  将执行:", sql)
    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        changed = conn.execute(text(sql)).rowcount
    print(f"  已更新 {changed} 行")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
