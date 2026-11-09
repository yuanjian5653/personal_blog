"""
给 author_profiles 加 nickname（作者标签显示用的昵称）。

幂等。

用法：
    python scripts/migrate_author_nickname.py --dry-run
    python scripts/migrate_author_nickname.py --yes
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

    insp = inspect(engine)
    if "author_profiles" not in insp.get_table_names():
        print("  author_profiles 表不存在（create_all 会建），跳过")
        return 0

    cols = {c["name"] for c in insp.get_columns("author_profiles")}
    if "nickname" in cols:
        print("  nickname 已存在，无需迁移")
        return 0

    sql = "ALTER TABLE author_profiles ADD COLUMN nickname VARCHAR(60) NULL"
    print("  将执行:", sql)
    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        conn.execute(text(sql))
    print("  完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
