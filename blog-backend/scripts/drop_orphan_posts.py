"""删除历史遗留的孤立表 posts（含结构备份）。只读 + 单条 DROP，执行前会二次确认。

用法：
    python scripts/drop_orphan_posts.py --dry-run   # 只看会发生什么
    python scripts/drop_orphan_posts.py --yes       # 真正执行
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, inspect, text  # noqa: E402

from app.config import settings  # noqa: E402

TABLE = "posts"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="确认执行删除")
    ap.add_argument("--dry-run", action="store_true", help="只预览，不改动")
    args = ap.parse_args()

    engine = create_engine(settings.DATABASE_URL)
    insp = inspect(engine)

    tables = insp.get_table_names()
    print(f"当前表的数量: {len(tables)}")

    if TABLE not in tables:
        print(f"[跳过] 没有 {TABLE} 表，无需处理")
        return 0

    cols = [c["name"] for c in insp.get_columns(TABLE)]
    with engine.connect() as c:
        rows = c.execute(text(f"SELECT COUNT(*) FROM `{TABLE}`")).scalar()

    print(f"\n表 `{TABLE}`")
    print(f"   字段: {', '.join(cols)}")
    print(f"   行数: {rows}")

    # 安全检查 1：代码里有没有引用
    app_dir = Path(__file__).resolve().parent.parent / "app"
    refs = []
    for p in app_dir.rglob("*.py"):
        for i, line in enumerate(
            p.read_text(encoding="utf-8", errors="replace").splitlines(), 1
        ):
            # 只找字符串里的 "posts"（表名），排除注释
            code = line.split("#", 1)[0]
            if '"posts"' in code or "'posts'" in code:
                refs.append(f"{p.relative_to(app_dir.parent)}:{i}: {line.strip()}")

    print(f"\n代码中引用字面量 \"posts\" 的位置: {len(refs)}")
    for r in refs:
        print("   ", r)

    if refs:
        print("\n[中止] 代码里仍有引用，删表会导致运行时报错。请先清理代码。")
        return 1

    # 安全检查 2：有数据就不删
    if rows:
        print(f"\n[中止] 表里有 {rows} 行数据，不自动删除。请先自行确认并备份。")
        return 1

    # 备份结构（万一将来要恢复）
    backup_dir = Path(__file__).resolve().parent.parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"dropped-{TABLE}-{stamp}.json"
    backup.write_text(
        json.dumps(
            {
                "table": TABLE,
                "dropped_at": stamp,
                "columns": [
                    {"name": c["name"], "type": str(c["type"]), "nullable": c["nullable"]}
                    for c in insp.get_columns(TABLE)
                ],
                "note": "该表无模型定义、无代码引用、0 行数据，属早期 Post 模型遗留。",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n结构已备份到: {backup}")

    if args.dry_run or not args.yes:
        print("\n[dry-run] 未执行删除。确认无误后加 --yes 重新运行。")
        return 0

    with engine.begin() as c:
        c.execute(text(f"DROP TABLE `{TABLE}`"))
    print(f"[完成] 已删除表 `{TABLE}`")

    remaining = inspect(engine).get_table_names()
    print(f"现在表的数量: {len(remaining)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
