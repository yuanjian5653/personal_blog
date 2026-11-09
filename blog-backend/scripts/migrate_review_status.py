"""
阶段 2-A 迁移：内容审核字段 + 作者档案表。

做三件事（全部幂等）：

  1. 5 张内容表加 review_status（默认 approved）
  2. 4 张表补 status（默认 published）—— 它们原来根本没有"是否公开"的概念
  3. 把现有数据统一回填成"已通过 + 已发布"

**为什么历史数据一律 approved**
    迁移前所有内容都是站长自己发的、本来就是公开的。
    如果给它们打上 pending，等于一上线全站内容集体消失。
    审核只对"迁移之后新提交的成员内容"生效。

author_profiles 表由 init_db()/create_all() 自动建，这里只补已有表的列。

用法：
    python scripts/migrate_review_status.py --dry-run
    python scripts/migrate_review_status.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

# (表名, 需要 review_status, 需要 status)
TABLES = (
    ("articles", True, False),
    ("essays", True, True),
    ("life_posts", True, True),
    ("photos", True, True),
    ("friend_links", True, True),
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    present = set(insp.get_table_names())
    statements: list[str] = []

    for table, want_review, want_status in TABLES:
        if table not in present:
            print(f"  跳过 {table}（表不存在）")
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if want_review and "review_status" not in cols:
            statements.append(
                f"ALTER TABLE {table} "
                f"ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'approved', "
                f"ADD INDEX ix_{table}_review_status (review_status)"
            )
        if want_status and "status" not in cols:
            statements.append(
                f"ALTER TABLE {table} "
                f"ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'published', "
                f"ADD INDEX ix_{table}_status (status)"
            )

    if not statements:
        print("  列都已存在，跳过加列")
    else:
        for sql in statements:
            print("  将执行:", sql[:120])

    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if statements and not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    for sql in statements:
        with engine.begin() as conn:
            conn.execute(text(sql))
    if statements:
        print(f"  已执行 {len(statements)} 条 ALTER")

    # ---- 回填：历史数据全部视为"已通过 + 已发布" ----
    for table, want_review, want_status in TABLES:
        if table not in present:
            continue
        with engine.begin() as conn:
            n_review = conn.execute(
                text(
                    f"UPDATE {table} SET review_status = 'approved' "
                    f"WHERE review_status IS NULL OR review_status = ''"
                )
            ).rowcount
            n_status = 0
            if want_status:
                n_status = conn.execute(
                    text(
                        f"UPDATE {table} SET status = 'published' "
                        f"WHERE status IS NULL OR status = ''"
                    )
                ).rowcount
        print(f"    {table}: 审核状态补 {n_review} 行，发布状态补 {n_status} 行")

    print("  完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
