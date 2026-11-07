"""
给 essay_likes 加「一条动态一个人只能赞一次」的唯一索引。

背景：essay_likes 是**通用目标点赞表**（essay_id 与 life_post_id 二选一），
但模型里只声明了 (essay_id, commenter_id) 的唯一约束，
对动态点赞没有任何数据库级去重 —— 并发下 toggle 可能插进两行。

注意：MySQL 的唯一索引把 NULL 视为互不相同，
所以这个索引只约束"有 life_post_id 的行"，完全不影响随笔点赞。

幂等：索引已存在就跳过；加索引前先删掉历史重复行（保留最早那条）。

用法：
    python scripts/migrate_life_like_unique.py --dry-run
    python scripts/migrate_life_like_unique.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

TABLE = "essay_likes"
INDEX = "uq_life_like"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    if TABLE not in insp.get_table_names():
        print(f"  {TABLE} 表不存在，跳过（create_all 会建表）")
        return 0

    names = {ix["name"] for ix in insp.get_indexes(TABLE)}
    if INDEX in names:
        print(f"  索引 {INDEX} 已存在，无需迁移")
        return 0

    dup_sql = (
        f"DELETE t1 FROM {TABLE} t1 "
        f"JOIN {TABLE} t2 "
        f"  ON t1.life_post_id = t2.life_post_id "
        f" AND t1.commenter_id = t2.commenter_id "
        f" AND t1.id > t2.id "
        f"WHERE t1.life_post_id IS NOT NULL"
    )
    idx_sql = (
        f"ALTER TABLE {TABLE} ADD UNIQUE KEY {INDEX} "
        f"(life_post_id, commenter_id)"
    )

    with engine.connect() as c:
        dup = c.execute(
            text(
                f"SELECT COUNT(*) FROM {TABLE} WHERE life_post_id IS NOT NULL"
            )
        ).scalar()

    print(f"  动态点赞现有行数: {dup}")
    print("  步骤 1 去重:", dup_sql[:70], "...")
    print("  步骤 2 建索引:", idx_sql)

    if args.dry_run:
        print("  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        removed = conn.execute(text(dup_sql)).rowcount
        print(f"  已删除重复行: {removed}")
        conn.execute(text(idx_sql))

    names = {ix["name"] for ix in inspect(engine).get_indexes(TABLE)}
    print(f"  完成，索引存在: {INDEX in names}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
