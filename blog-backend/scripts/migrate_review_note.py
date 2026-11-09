"""
给 5 张内容表加 review_note（审核意见 / 驳回理由）。

为什么需要它：
    驳回的理由原来只写进 operation_logs —— 那是给管理员看的审计日志，
    成员在后台看不到自己为什么被驳回，只能干等。

幂等：列已存在就跳过。

用法：
    python scripts/migrate_review_note.py --dry-run
    python scripts/migrate_review_note.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

TABLES = ("articles", "essays", "life_posts", "photos", "friend_links")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    present = set(insp.get_table_names())

    statements = []
    for table in TABLES:
        if table not in present:
            print(f"  跳过 {table}（表不存在）")
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "review_note" not in cols:
            statements.append(
                f"ALTER TABLE {table} ADD COLUMN review_note VARCHAR(500) NULL"
            )

    if not statements:
        print("  review_note 已存在，无需迁移")
        return 0

    for sql in statements:
        print("  将执行:", sql)
    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    for sql in statements:
        with engine.begin() as conn:
            conn.execute(text(sql))
    print(f"  已执行 {len(statements)} 条 ALTER")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
