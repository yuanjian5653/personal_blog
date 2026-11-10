"""
图片组成为审核单位：albums 表加审核字段。

同时把 photos 的历史待审状态清掉 —— 现在审的是**图片组**，
照片跟随相册，不再逐张审核。否则老的待审照片会永远卡在待审。

幂等。

用法：
    python scripts/migrate_album_review.py --dry-run
    python scripts/migrate_album_review.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

COLUMNS = (
    ("review_status", "VARCHAR(20) NOT NULL DEFAULT 'approved'"),
    ("review_note", "VARCHAR(500) NULL"),
    ("status", "VARCHAR(20) NOT NULL DEFAULT 'published'"),
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    insp = inspect(engine)
    if "albums" not in insp.get_table_names():
        print("  albums 表不存在，跳过")
        return 0

    cols = {c["name"] for c in insp.get_columns("albums")}
    statements = [
        f"ALTER TABLE albums ADD COLUMN {n} {ddl}"
        for n, ddl in COLUMNS
        if n not in cols
    ]

    if statements:
        for sql in statements:
            print("  将执行:", sql)
    else:
        print("  albums 审核列已存在")

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

    # 照片跟随相册：老的待审照片一律放行（历史数据，此前没有相册级审核）
    with engine.begin() as conn:
        n = conn.execute(
            text(
                "UPDATE photos SET review_status = 'approved', status = 'published' "
                "WHERE review_status <> 'approved' OR status <> 'published'"
            )
        ).rowcount
    print(f"  photos 待审状态清理: {n} 行")

    with engine.begin() as conn:
        n2 = conn.execute(
            text(
                "UPDATE albums SET review_status = 'approved', status = 'published' "
                "WHERE review_status IS NULL OR review_status = ''"
            )
        ).rowcount
    print(f"  albums 历史数据回填 approved: {n2} 行")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
