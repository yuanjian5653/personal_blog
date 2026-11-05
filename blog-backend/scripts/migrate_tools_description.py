"""给 tools 表补上 description 列（幂等）。

背景：项目没有 Alembic，表由 SQLModel.metadata.create_all() 创建，而
create_all **只建不存在的表，不会给已存在的表加列**。所以凡是"给已上线的表
加字段"，都要跑一次这种脚本（项目里已有先例：migrate_comments_target.py）。

什么时候**不需要**跑：
  表还不存在（例如还没部署过工具功能）—— 后端启动时 create_all 会按新模型
  一次建好，列自然就有。

用法：
  python scripts/migrate_tools_description.py --dry-run   # 只看会发生什么
  python scripts/migrate_tools_description.py --yes       # 真正执行
"""
import argparse
import sys
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import create_engine

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import settings  # noqa: E402

TABLE = "tools"
COLUMN = "description"
DDL = f"ALTER TABLE `{TABLE}` ADD COLUMN `{COLUMN}` TEXT NULL"


def main() -> int:
    parser = argparse.ArgumentParser(description="给 tools 表补 description 列")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不执行")
    parser.add_argument("--yes", action="store_true", help="确认执行")
    args = parser.parse_args()

    if not args.dry_run and not args.yes:
        print("需要显式确认：加 --dry-run 预览，或 --yes 执行")
        return 1

    engine = create_engine(settings.DATABASE_URL)
    inspector = inspect(engine)

    if TABLE not in inspector.get_table_names():
        print(f"[跳过] 表 {TABLE} 还不存在。")
        print("       重启后端时 create_all 会按新模型直接建好（带 description 列）。")
        return 0

    columns = [c["name"] for c in inspector.get_columns(TABLE)]
    print(f"[现状] {TABLE} 现有列（{len(columns)} 个）：{columns}")

    if COLUMN in columns:
        print(f"[跳过] {TABLE}.{COLUMN} 已存在，无需迁移。")
        return 0

    print(f"[计划] {DDL}")
    if args.dry_run:
        print("[dry-run] 未执行。确认无误后加 --yes 再跑一次。")
        return 0

    with engine.begin() as conn:
        conn.execute(text(DDL))

    after = [c["name"] for c in inspect(engine).get_columns(TABLE)]
    if COLUMN in after:
        print(f"[完成] 已添加 {TABLE}.{COLUMN}；现有列（{len(after)} 个）：{after}")
        return 0

    print("[失败] 列没有加上，请检查数据库权限")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
