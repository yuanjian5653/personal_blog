"""
回填 friend_links.author_id（历史上创建时没记归属，落库是 NULL）。

怎么找回是谁创建的：
    log_operation 在建友链时写了 action='create'、target_type='friend_link'、
    target_id=新友链 id、admin_id=创建者。所以能从操作日志反推。

幂等。

用法：
    python scripts/migrate_friendlink_author.py --dry-run
    python scripts/migrate_friendlink_author.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    with engine.connect() as c:
        null_count = c.execute(
            text("SELECT COUNT(*) FROM friend_links WHERE author_id IS NULL")
        ).scalar() or 0
        recoverable = c.execute(
            text(
                "SELECT COUNT(*) FROM friend_links fl "
                "JOIN operation_logs ol ON ol.target_type = 'friend_link' "
                "  AND ol.target_id = fl.id AND ol.action = 'create' "
                "WHERE fl.author_id IS NULL"
            )
        ).scalar() or 0

    print(f"  author_id 为空的友链：{null_count} 条")
    print(f"  其中能从操作日志反推出创建者的：{recoverable} 条")

    if recoverable == 0:
        print("  没有可回填的数据")
        return 0

    if args.dry_run:
        with engine.connect() as c:
            rows = c.execute(
                text(
                    "SELECT fl.id, fl.name, ol.admin_id FROM friend_links fl "
                    "JOIN operation_logs ol ON ol.target_type = 'friend_link' "
                    "  AND ol.target_id = fl.id AND ol.action = 'create' "
                    "WHERE fl.author_id IS NULL LIMIT 10"
                )
            ).fetchall()
        for r in rows:
            print(f"    #{r[0]} {r[1]} -> admin #{r[2]}")
        print("  （dry-run，未执行）")
        return 0

    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        # 同一条友链可能有多条 create 日志（极少见），取最早的
        n = conn.execute(
            text(
                "UPDATE friend_links fl "
                "JOIN ( "
                "  SELECT target_id, MIN(id) AS log_id "
                "  FROM operation_logs "
                "  WHERE target_type = 'friend_link' AND action = 'create' "
                "  GROUP BY target_id "
                ") first_log ON first_log.target_id = fl.id "
                "JOIN operation_logs ol ON ol.id = first_log.log_id "
                "SET fl.author_id = ol.admin_id "
                "WHERE fl.author_id IS NULL"
            )
        ).rowcount
    print(f"  已回填 {n} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
