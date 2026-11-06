"""
给 tools 表加 color 列（工具强调色的预设名）。

幂等：已经有这一列就跳过，可以重复跑。

用法：
    python scripts/migrate_tools_color.py --dry-run
    python scripts/migrate_tools_color.py --yes
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
    if "tools" not in insp.get_table_names():
        print("  tools 表不存在，跳过（create_all 会直接建出带 color 的新表）")
        return 0

    if "color" in [c["name"] for c in insp.get_columns("tools")]:
        print("  color 列已存在，无需迁移")
        return 0

    sql = "ALTER TABLE tools ADD COLUMN color VARCHAR(20) NULL"
    print("  将执行:", sql)
    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        conn.execute(text(sql))
    print("  完成，color 列存在:",
          "color" in [c["name"] for c in inspect(engine).get_columns("tools")])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
