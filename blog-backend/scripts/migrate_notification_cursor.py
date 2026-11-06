"""
给 notification_outbox 加 last_commenter_id（发送游标）。

幂等：已经有这一列就跳过。

用法：
    python scripts/migrate_notification_cursor.py --dry-run
    python scripts/migrate_notification_cursor.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

TABLE = "notification_outbox"
COLUMN = "last_commenter_id"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    if TABLE not in insp.get_table_names():
        print(f"  {TABLE} 表不存在，跳过（create_all 会直接建出带该列的新表）")
        return 0


    # ---- 第 1 步：加发送游标列 ----
    added = False
    if COLUMN in [c["name"] for c in insp.get_columns(TABLE)]:
        print(f"  {COLUMN} 列已存在，跳过")
    else:
        sql = f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} INT NULL"
        print("  将执行:", sql)
        if args.dry_run:
            print("  （dry-run，未执行）")
        elif not args.yes:
            print("  需要 --yes 才会真的执行")
            return 1
        else:
            with engine.begin() as conn:
                conn.execute(text(sql))
            added = True
            print("  完成，列存在:",
                  COLUMN in [c["name"] for c in inspect(engine).get_columns(TABLE)])

    # ---- 第 2 步：target_id 扩成 BIGINT ----
    #
    # 手动"网站更新"公告的 target_id 放的是毫秒时间戳（约 1.8e12），
    # INT 最大只有 21 亿，写进去直接报 Out of range value。
    cols = {c["name"]: c for c in inspect(engine).get_columns(TABLE)}
    target = cols.get("target_id")
    dtype = str(target["type"]).lower() if target else ""
    if "bigint" in dtype:
        print("  target_id 已是 BIGINT，跳过")
        return 0

    sql2 = f"ALTER TABLE {TABLE} MODIFY COLUMN target_id BIGINT NOT NULL"
    print("  将执行:", sql2, f"(当前类型 {dtype})")
    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        conn.execute(text(sql2))
    cols = {c["name"]: c for c in inspect(engine).get_columns(TABLE)}
    print("  完成，target_id 现在是:", cols["target_id"]["type"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
