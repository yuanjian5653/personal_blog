"""
修复 photos.file_path 与磁盘文件名不一致（扩展名曾经被批量改过）。

背景：
    某次「优化媒体」操作把一部分 .png 重新压成 .jpg 并改了文件名，
    但数据库里的 file_path 没跟着改。于是前端请求
        /media/thumbs/xxx.png  → 404（文件已经是 xxx.jpg）
    表现就是相册里那几张图裂掉，控制台一片 404。

做法：
    对每条 file_path：
      1. 磁盘上同名文件存在 → 不用动
      2. 否则用**相同的文件名主干**在 media/photos 里找唯一匹配
         （只换扩展名，stem 必须完全一致）→ 更新数据库
      3. 都找不到 → 报告出来，不猜（绝不按顺序或模糊匹配乱改）

只改 file_path 这一列，不动文件、不删记录。

用法：
    python scripts/fix_photo_paths.py --dry-run     # 只看要改什么
    python scripts/fix_photo_paths.py --yes         # 真的改
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import engine  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    photo_dir = settings.PHOTO_DIR
    thumb_dir = settings.THUMB_DIR

    if not photo_dir.exists():
        print(f"  {photo_dir} 不存在，无法核对")
        return 1

    # stem(小写) → 真实文件名。同一 stem 有多个扩展名时标记为歧义，不猜
    by_stem: dict[str, list[str]] = {}
    for p in photo_dir.iterdir():
        if p.is_file():
            by_stem.setdefault(p.stem.lower(), []).append(p.name)

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, file_path FROM photos ORDER BY id")).fetchall()

    print(f"  photos 记录 {len(rows)} 条，media/photos 文件 {sum(len(v) for v in by_stem.values())} 个")

    to_fix: list[tuple[int, str, str]] = []
    ambiguous: list[tuple[int, str, list[str]]] = []
    missing: list[tuple[int, str]] = []

    for pid, fp in rows:
        if (photo_dir / fp).exists():
            continue
        cands = by_stem.get(Path(fp).stem.lower(), [])
        if len(cands) == 1:
            to_fix.append((pid, fp, cands[0]))
        elif len(cands) > 1:
            ambiguous.append((pid, fp, cands))
        else:
            missing.append((pid, fp))

    print(f"\n  需要改: {len(to_fix)} 条")
    for pid, old, new in to_fix:
        ok_thumb = "缩略图在" if (thumb_dir / new).exists() else "缩略图也缺"
        print(f"    id={pid}  {old}  →  {new}   [{ok_thumb}]")

    if ambiguous:
        print(f"\n  歧义（同名多个扩展名，不自动改）: {len(ambiguous)}")
        for pid, old, cands in ambiguous:
            print(f"    id={pid}  {old}  候选={cands}")

    if missing:
        print(f"\n  彻底找不到: {len(missing)}")
        for pid, old in missing:
            print(f"    id={pid}  {old}")

    if not to_fix:
        print("\n  无需修改")
        return 0

    if args.dry_run:
        print("\n  （dry-run，未执行）")
        return 0
    if not args.yes:
        print("\n  需要 --yes 才会真的执行")
        return 1

    with engine.begin() as conn:
        for pid, _old, new in to_fix:
            conn.execute(
                text("UPDATE photos SET file_path = :new WHERE id = :pid"),
                {"new": new, "pid": pid},
            )
    print(f"\n  已更新 {len(to_fix)} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
