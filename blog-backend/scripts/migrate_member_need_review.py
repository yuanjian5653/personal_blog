"""
给 admin 加 need_review（按成员设置审核策略）。

NULL = 跟随站点全局开关（默认，兼容现状）
TRUE = 该成员的内容必须审核
FALSE = 该成员免审

幂等。

用法：
    python scripts/migrate_member_need_review.py --dry-run
    python scripts/migrate_member_need_review.py --yes
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
    if "admin" not in insp.get_table_names():
        print("  admin 表不存在，跳过")
        return 0

    cols = {c["name"] for c in insp.get_columns("admin")}
    if "need_review" in cols:
        print("  need_review 已存在，无需迁移")
        return 0

    sql = "ALTER TABLE admin ADD COLUMN need_review TINYINT(1) NULL"
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
