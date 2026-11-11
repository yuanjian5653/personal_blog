"""
成员的「音乐 + 项目」权限：加字段并回填历史数据。

  admin.music_quota         本地音乐上传上限（NULL = 用默认值）
  admin.netease_enabled     是否允许用网易云
  admin.github_token        成员自己的 GitHub Token
  songs.author_id           上传者
  projects.author_id        同步者

幂等。

用法：
    python scripts/migrate_member_music_project.py --dry-run
    python scripts/migrate_member_music_project.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

COLUMNS = {
    "admin": (
        ("music_quota", "INT NULL"),
        ("netease_enabled", "TINYINT(1) NULL"),
        ("github_token", "VARCHAR(255) NULL"),
        ("github_username", "VARCHAR(100) NULL"),
    ),
    "songs": (("author_id", "INT NULL"),),
    "projects": (("author_id", "INT NULL"),),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    tables = set(insp.get_table_names())

    statements: list[str] = []
    for table, cols in COLUMNS.items():
        if table not in tables:
            print(f"  {table} 表不存在，跳过")
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols:
            if name not in have:
                statements.append(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")

    if not statements:
        print("  列都已存在，无需迁移")
    else:
        for sql in statements:
            print("  将执行:", sql)

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

    # 历史数据都是站长建的，回填成第一个管理员
    with engine.begin() as conn:
        root_id = conn.execute(
            text("SELECT id FROM admin WHERE role = 'admin' ORDER BY id LIMIT 1")
        ).scalar()
        if root_id is None:
            print("  没有管理员账号，跳过回填")
            return 0

        n1 = conn.execute(
            text("UPDATE songs SET author_id = :i WHERE author_id IS NULL"),
            {"i": root_id},
        ).rowcount
        n2 = conn.execute(
            text("UPDATE projects SET author_id = :i WHERE author_id IS NULL"),
            {"i": root_id},
        ).rowcount
    print(f"  历史数据回填到管理员 #{root_id}: songs {n1} 行, projects {n2} 行")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
