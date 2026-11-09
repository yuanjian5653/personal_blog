"""
阶段 1 迁移：后台多角色 + 内容作者归属。

做三件事（全部幂等）：

  1. admin 表加列：role / status / display_name / upload_quota / last_login_at
     并把现有管理员回填成 role='admin'、status='active'、display_name=username

  2. 6 张内容表加 author_id（可为空，外键到 admin.id）

  3. 把现有内容的 author_id 回填成"最早创建的那个管理员"
     （阶段 1 之前所有内容都是同一个人发的）

为什么要"先加可空列 → 再回填"：
    直接加 NOT NULL 会在有数据的表上失败；先把列加成可空、
    回填完再考虑约束，是标准做法。author_id 允许为空是有意的 ——
    NULL 表示"迁移前的历史数据"，展示时按站长兜底。

用法：
    python scripts/migrate_member_roles.py --dry-run
    python scripts/migrate_member_roles.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

ADMIN_COLUMNS = (
    ("role", "VARCHAR(20) NOT NULL DEFAULT 'admin'"),
    ("status", "VARCHAR(20) NOT NULL DEFAULT 'active'"),
    ("display_name", "VARCHAR(60) NULL"),
    ("upload_quota", "INT NULL"),
    ("last_login_at", "DATETIME NULL"),
)

# 加了 author_id 的表（主键列名统一是 id）
CONTENT_TABLES = (
    "articles",
    "essays",
    "life_posts",
    "albums",
    "photos",
    "friend_links",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    tables = set(insp.get_table_names())

    if "admin" not in tables:
        print("  admin 表不存在，请先跑 scripts/init_db.py")
        return 1

    statements: list[tuple[str, str]] = []

    # ---- 1. admin 加列 ----
    existing = {c["name"] for c in insp.get_columns("admin")}
    for name, ddl in ADMIN_COLUMNS:
        if name not in existing:
            statements.append(
                (f"admin.{name}", f"ALTER TABLE admin ADD COLUMN {name} {ddl}")
            )

    # ---- 2. 内容表加 author_id ----
    for table in CONTENT_TABLES:
        if table not in tables:
            print(f"  跳过 {table}（表不存在）")
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "author_id" not in cols:
            statements.append(
                (
                    f"{table}.author_id",
                    f"ALTER TABLE {table} ADD COLUMN author_id INT NULL, "
                    f"ADD INDEX ix_{table}_author_id (author_id)",
                )
            )

    if not statements:
        print("  列都已存在，跳过加列")
    else:
        for label, sql in statements:
            print("  将执行:", sql[:110] + ("..." if len(sql) > 110 else ""))

    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if statements and not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    for _label, sql in statements:
        with engine.begin() as conn:
            conn.execute(text(sql))
    if statements:
        print(f"  已执行 {len(statements)} 条 ALTER")

    # ---- 3. 回填 ----
    with engine.connect() as conn:
        owner_id = conn.execute(
            text("SELECT id FROM admin ORDER BY id ASC LIMIT 1")
        ).scalar()

        if owner_id is None:
            print("  没有管理员账号，跳过回填")
            return 0

        print(f"  最早的管理员 id = {owner_id}")

        backfilled = 0
        for table in CONTENT_TABLES:
            if table not in tables:
                continue
            with engine.begin() as conn2:
                n = conn2.execute(
                    text(
                        f"UPDATE {table} SET author_id = :aid "
                        f"WHERE author_id IS NULL"
                    ),
                    {"aid": owner_id},
                ).rowcount
            print(f"    {table}: 回填 {n} 行")
            backfilled += n

        # 兜底：display_name 为空的补成 username
        with engine.begin() as conn3:
            n = conn3.execute(
                text(
                    "UPDATE admin SET display_name = username "
                    "WHERE display_name IS NULL OR display_name = ''"
                )
            ).rowcount
        print(f"    admin.display_name: 补全 {n} 行")

    print(f"  完成，内容共回填 {backfilled} 行")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
