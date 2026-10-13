"""
评论/统计相关表结构迁移。

⚠️ 为什么需要这个脚本：
本项目没有 Alembic，表由 SQLModel.metadata.create_all() 创建，
而 create_all **只建不存在的表，不会修改已有表结构**。
所以在**已有数据的库**上，模型里新增的字段不会自动出现，必须跑这个脚本。
新库直接 create_all 即可；跑本脚本也无副作用（幂等，可重复执行）。

做这些事：
  1. comments.essay_id       -> 允许 NULL
  2. comments.life_post_id   -> 新增（FK + 索引）
  3. comments.article_id     -> 新增（FK + 索引）
  4. comments.ip / status    -> 新增（后台评论管理要展示 IP 与审核状态）
  5. essay_likes             -> essay_id 允许 NULL、新增 life_post_id
  6. page_views              -> 新增表（仪表盘的访客趋势 / 浏览器分布）

用法：
    python scripts/migrate_comments_target.py            # 执行
    python scripts/migrate_comments_target.py --dry-run  # 只看会做什么
"""
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import settings  # noqa: E402

DRY_RUN = "--dry-run" in sys.argv

engine = create_engine(settings.DATABASE_URL, echo=False)


def column_names(insp, table: str) -> set[str]:
    try:
        return {c["name"] for c in insp.get_columns(table)}
    except Exception:
        return set()


def table_exists(insp, table: str) -> bool:
    return table in insp.get_table_names()


def is_nullable(table: str, column: str) -> bool | None:
    """查某列是否允许 NULL（None 表示查不到）"""
    with engine.connect() as c:
        row = c.execute(
            text(
                "SELECT IS_NULLABLE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = :t AND COLUMN_NAME = :c"
            ),
            {"t": table, "c": column},
        ).first()
    if row is None:
        return None
    return row[0] == "YES"


def run(sql: str, label: str) -> None:
    print(f"  - {label}")
    if DRY_RUN:
        print(f"      [dry-run] {sql}")
        return
    with engine.begin() as conn:
        conn.execute(text(sql))
    print("      done")


def main() -> int:
    insp = inspect(engine)
    changed = 0

    if not table_exists(insp, "comments"):
        print("comments 表不存在 —— 请先跑 init_db.py 建表，无需迁移。")
        return 0

    cols = column_names(insp, "comments")

    # ---- 1. comments.essay_id 允许 NULL ----
    print("=== comments 表 ===")
    if is_nullable("comments", "essay_id") is False:
        run(
            "ALTER TABLE comments MODIFY COLUMN essay_id INT NULL",
            "essay_id 改为允许 NULL（评论可能属于生活动态/文章/留言板）",
        )
        changed += 1
    else:
        print("  - essay_id 已经允许 NULL，跳过")

    # ---- 2/3. 新增目标外键 ----
    for col, ref_table, fk_name in (
        ("life_post_id", "life_posts", "fk_comments_life_post"),
        ("article_id", "articles", "fk_comments_article"),
    ):
        if col in cols:
            print(f"  - {col} 已存在，跳过")
            continue
        run(f"ALTER TABLE comments ADD COLUMN {col} INT NULL", f"新增 {col}")
        run(
            f"ALTER TABLE comments ADD INDEX ix_comments_{col} ({col})",
            f"为 {col} 建索引",
        )
        run(
            f"ALTER TABLE comments ADD CONSTRAINT {fk_name} "
            f"FOREIGN KEY ({col}) REFERENCES {ref_table}(id)",
            f"为 {col} 建外键 -> {ref_table}",
        )
        changed += 3

    # ---- 4. 审核字段 ----
    print("\n=== comments 审核字段 ===")
    if "ip" in cols:
        print("  - ip 已存在，跳过")
    else:
        run("ALTER TABLE comments ADD COLUMN ip VARCHAR(64) NULL", "新增 ip")
        changed += 1

    if "status" in cols:
        print("  - status 已存在，跳过")
    else:
        run(
            "ALTER TABLE comments ADD COLUMN status VARCHAR(20) "
            "NOT NULL DEFAULT 'approved'",
            "新增 status（默认 approved）",
        )
        run(
            "ALTER TABLE comments ADD INDEX ix_comments_status (status)",
            "为 status 建索引",
        )
        changed += 2

    # ---- 5. essay_likes 支持多目标 ----
    print("\n=== essay_likes 表 ===")
    if not table_exists(insp, "essay_likes"):
        print("  - 表不存在，跳过（init_db.py 会按新模型创建）")
    else:
        like_cols = column_names(insp, "essay_likes")

        if is_nullable("essay_likes", "essay_id") is False:
            run(
                "ALTER TABLE essay_likes MODIFY COLUMN essay_id INT NULL",
                "essay_id 改为允许 NULL",
            )
            changed += 1
        else:
            print("  - essay_id 已经允许 NULL，跳过")

        if "life_post_id" in like_cols:
            print("  - life_post_id 已存在，跳过")
        else:
            run(
                "ALTER TABLE essay_likes ADD COLUMN life_post_id INT NULL",
                "新增 life_post_id",
            )
            run(
                "ALTER TABLE essay_likes ADD INDEX "
                "ix_essay_likes_life_post_id (life_post_id)",
                "为 life_post_id 建索引",
            )
            changed += 2

    # ---- 6. 访问统计表 ----
    print("\n=== page_views 表 ===")
    if table_exists(insp, "page_views"):
        print("  - 表已存在，跳过")
    else:
        # 交给 SQLModel 按模型建表：字段定义只保留在模型里一处，
        # 避免脚本里再抄一遍导致两边不一致。
        print("  - 表不存在，按模型创建")
        if DRY_RUN:
            print("      [dry-run] SQLModel.metadata.create_all()")
        else:
            from app.database import init_db

            init_db()
            print("      done")
        changed += 1

    # ---- 汇总 ----
    print()
    if DRY_RUN:
        print(f"[dry-run] 共 {changed} 项待执行改动")
    elif changed:
        print(f"[完成] 共执行 {changed} 项改动，表结构已更新")
    else:
        print("[完成] 表结构已是目标状态，无需改动")

    if not DRY_RUN:
        insp = inspect(engine)
        print("\n=== 迁移后 comments 字段 ===")
        for col in insp.get_columns("comments"):
            print(f"  {col['name']:16s} nullable={col['nullable']}")
        print("\n=== 迁移后 page_views 表 ===")
        print("  存在" if table_exists(insp, "page_views") else "  !! 未创建")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
