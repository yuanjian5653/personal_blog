"""
压缩 media 下的大图（原地覆盖，不换文件名）。

背景：服务器公网带宽只有约 1Mbps，而 media/photos 里有多个 3~4MB 的图，
首页背景图甚至是一张 3616x2064 的 PNG（3.1MB）。一张图要下 26 秒，
整站体感就被拖死了。

策略（保守、可回滚）：
  · 只处理 photos / covers 目录下的图片
  · **不重命名、不改扩展名** —— 不需要改站点配置，也不会让缩略图失配
  · 超过 --max-size 的按长边等比缩小
  · JPEG 用 quality 重新编码（默认 82）
  · PNG：有透明通道就只 optimize，否则量化到 256 色（照片类 PNG 收益极大）
  · **先编码到内存比较体积，只有变小才写回** —— 不会把图压坏或压大
  · 真正执行前先把整个 media 打包备份

用法：
    python scripts/optimize_media.py --dry-run          # 只报告预计效果
    python scripts/optimize_media.py                    # 真正执行
    python scripts/optimize_media.py --max-size 1920 --quality 82 --min-kb 400
"""
from __future__ import annotations

import argparse
import io
import sys
import tarfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from app.config import settings  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent
DEFAULT_MEDIA = BACKEND / settings.MEDIA_ROOT
BACKUP_DIR = BACKEND / "backups"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def human(n: float) -> str:
    return f"{n/1024:.0f} KB" if n < 1024 * 1024 else f"{n/1024/1024:.1f} MB"


def backup_media(media_dir: Path) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    out = BACKUP_DIR / f"media-before-optimize-{datetime.now():%Y%m%d-%H%M%S}.tar.gz"
    print(f"[备份] {media_dir} -> {out}")
    with tarfile.open(out, "w:gz") as tar:
        tar.add(media_dir, arcname="media")
    print(f"[备份] 完成：{human(out.stat().st_size)}")
    return out


def encode(im: Image.Image, ext: str, quality: int) -> bytes:
    """把图片按目标格式编码到内存，返回字节。"""
    buf = io.BytesIO()
    if ext in (".jpg", ".jpeg"):
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    elif ext == ".png":
        has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
        if has_alpha:
            im.save(buf, "PNG", optimize=True)
        else:
            im = im.convert("RGB").quantize(colors=256, method=Image.MEDIANCUT)
            im.save(buf, "PNG", optimize=True)
    else:  # webp
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")
        im.save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


def optimize_one(
    path: Path, *, max_size: int, quality: int, apply: bool
) -> tuple[int, int]:
    """返回 (原大小, 优化后大小)。apply=False 时只计算不写盘。"""
    before = path.stat().st_size

    with Image.open(path) as im:
        im.load()
        w, h = im.size
        longest = max(w, h)
        if longest > max_size:
            scale = max_size / longest
            im = im.resize(
                (max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS
            )
        try:
            data = encode(im, path.suffix.lower(), quality)
        except Exception as e:
            print(f"  [跳过] {path.name}: {type(e).__name__}: {e}")
            return before, before

    after = len(data)
    if after >= before:
        # 压完反而更大（例如已经高度压缩过的图）→ 保留原图
        return before, before

    if apply:
        # 先写临时文件再原子替换，避免中途失败留下半个文件
        tmp = path.with_suffix(path.suffix + ".opt")
        tmp.write_bytes(data)
        tmp.replace(path)

    return before, after


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只报告预计效果，不写盘")
    ap.add_argument("--max-size", type=int, default=1920, help="长边上限，默认 1920")
    ap.add_argument("--quality", type=int, default=82, help="JPEG/WebP 质量，默认 82")
    ap.add_argument("--min-kb", type=int, default=400, help="只处理大于该体积的，默认 400KB")
    ap.add_argument(
        "--root",
        default=None,
        help="media 目录（默认取 .env 的 MEDIA_ROOT）；测试时可指向副本",
    )
    args = ap.parse_args()

    media_dir = Path(args.root) if args.root else DEFAULT_MEDIA
    if not media_dir.exists():
        print(f"[错误] 目录不存在：{media_dir}")
        return 1

    files: list[Path] = []
    for sub in ("photos", "covers"):
        d = media_dir / sub
        if d.exists():
            files.extend(
                p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS
            )
    files.sort(key=lambda p: p.stat().st_size, reverse=True)

    targets = [p for p in files if p.stat().st_size >= args.min_kb * 1024]
    print(f"[扫描] {media_dir}")
    print(f"       图片 {len(files)} 个，其中 {len(targets)} 个超过 {args.min_kb}KB")
    if not targets:
        print("       无需处理")
        return 0

    total_before = sum(p.stat().st_size for p in targets)
    print(f"       待处理合计 {human(total_before)}，长边上限 {args.max_size}px，质量 {args.quality}")
    print()

    if not args.dry_run:
        if args.root:
            print("[跳过备份] 用了 --root，视为测试，未备份")
        else:
            backup_media(media_dir)
        print()

    rows = []
    for p in targets:
        b, a = optimize_one(p, max_size=args.max_size, quality=args.quality,
                            apply=not args.dry_run)
        pct = (1 - a / b) * 100 if b else 0
        rows.append((p.name, b, a, pct))
        mark = "" if a < b else "  (未变小，保留原图)"
        print(f"  {human(b):>9} -> {human(a):>9}  -{pct:4.0f}%  {p.name}{mark}")

    total_after = sum(r[2] for r in rows)
    saved = total_before - total_after
    pct_all = (saved / total_before * 100) if total_before else 0
    print()
    print(f"[结果] {human(total_before)} -> {human(total_after)}"
          f"  减少 {human(saved)}（{pct_all:.0f}%）")

    # 按 137KB/s（≈1Mbps）估算
    print(f"[带宽] 1Mbps 下这些图总下载时间：{total_before/1024/137:.0f}s -> {total_after/1024/137:.0f}s")

    if args.dry_run:
        print("[提示] dry-run，未修改任何文件。去掉 --dry-run 才真正执行。")
    else:
        print("[完成] 已原地覆盖。回滚：解压 backups/media-before-optimize-*.tar.gz")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
