"""
初始化两个内置暗号：星空（动态背景）与游戏（接星星）。

幂等：已存在同暗号就跳过，不会覆盖后台改过的内容。

用法：
    python scripts/seed_easter_eggs.py --dry-run
    python scripts/seed_easter_eggs.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, select  # noqa: E402

import app.models  # noqa: F401  ← 注册模型
from app.database import engine, init_db  # noqa: E402
from app.db_utils import model as db_model  # noqa: E402
from app.models import EasterEgg  # noqa: E402
from sqlmodel import Session  # noqa: E402

SEEDS = [
    {
        "code": "星空",
        "name": "动态背景",
        "hint": "抬头看看 —— 整片天都亮了",
        "kind": "background",
        # 没上传壁纸时，前台会自动回退到内置星空
        "asset_path": None,
        "asset_kind": None,
        "transition": "fade",
        "sort_order": 0,
    },
    {
        "code": "游戏",
        "name": "接星星",
        "hint": "左右移动接住星星，别让它们掉光",
        "kind": "game",
        "asset_path": None,
        "asset_kind": None,
        "transition": "fade",
        "sort_order": 10,
    },
]


def _norm(s: str) -> str:
    return "".join((s or "").split()).lower()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    init_db()
    if "easter_eggs" not in inspect(engine).get_table_names():
        print("  easter_eggs 表不存在（init_db 应该已经建了，请检查模型是否被导入）")
        return 1

    created = 0
    with Session(engine) as db:
        # exec() 返回的可能是 Row 而不是模型，统一用 db_model 解包
        existing = {
            _norm(r.code)
            for r in (db_model(x) for x in db.exec(select(EasterEgg)).all())
            if isinstance(r, EasterEgg)
        }
        for seed in SEEDS:
            if _norm(seed["code"]) in existing:
                print(f"  跳过（已存在）：{seed['code']}")
                continue
            print(f"  将创建：{seed['code']} → {seed['name']}（kind={seed['kind']}）")
            if args.dry_run or not args.yes:
                continue
            db.add(EasterEgg(**seed))
            created += 1
        if created and args.yes and not args.dry_run:
            db.commit()

    if args.dry_run:
        print("  （dry-run，未写入）")
        return 0
    if not args.yes:
        print("  需要 --yes 才会真的写入")
        return 1
    print(f"  完成，新建 {created} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
