"""
建 upload_logs 表（上传配额统计用）。

create_all 也会建它，但显式迁移能让部署脚本明确知道这一步做过什么，
并且在表已存在时不报错。

用法：
    python scripts/migrate_upload_log.py --dry-run
    python scripts/migrate_upload_log.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.database import engine, init_db  # noqa: E402
from app.models import UploadLog  # noqa: E402,F401


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    exists = "upload_logs" in inspect(engine).get_table_names()
    print("  upload_logs 已存在:", exists)
    if exists:
        print("  无需迁移")
        return 0

    if args.dry_run:
        print("  将执行 create_all（建 upload_logs 表）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    init_db()
    print("  已建表:", "upload_logs" in inspect(engine).get_table_names())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
