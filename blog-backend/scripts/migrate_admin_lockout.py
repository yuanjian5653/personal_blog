"""
给 admin 表加登录失败锁定字段（failed_attempts / locked_until）。

背景：/api/auth/login 原来没有任何限速与锁定，可以被无限次猜测密码。
      bcrypt 只是让每次尝试变慢，挡不住长期低速爆破。

幂等：列已存在就跳过。

用法：
    python scripts/migrate_admin_lockout.py --dry-run
    python scripts/migrate_admin_lockout.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

TABLE = "admin"
COLUMNS = (
    ("failed_attempts", "INT NOT NULL DEFAULT 0"),
    ("locked_until", "DATETIME NULL"),
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    if TABLE not in insp.get_table_names():
        print(f"  {TABLE} 表不存在，跳过（init_db 会建表）")
        return 0

    existing = {c["name"] for c in insp.get_columns(TABLE)}
    todo = [(n, ddl) for n, ddl in COLUMNS if n not in existing]

    if not todo:
        print("  两列都已存在，无需迁移")
        return 0

    for name, ddl in todo:
        sql = f"ALTER TABLE {TABLE} ADD COLUMN {name} {ddl}"
        print("  将执行:", sql)
        if args.dry_run:
            continue
        if not args.yes:
            print("  需要 --yes 才会真的执行")
            return 1
        with engine.begin() as conn:
            conn.execute(text(sql))

    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0

    now = {c["name"] for c in inspect(engine).get_columns(TABLE)}
    print("  完成，列存在:", {n: (n in now) for n, _ in COLUMNS})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
