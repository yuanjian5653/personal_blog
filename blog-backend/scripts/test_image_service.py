"""
图片压缩服务的回归测试。

背景：服务器公网带宽约 1Mbps（≈137KB/s），一张 3MB 的图要下 22 秒，
整页体感被拖死。所以上传管线必须保证：
  · 输出的图宽度不超过 MAX_WIDTH
  · 输出的图体积不超过 TARGET_MAX_BYTES（细节密集的照片要能自动降质量）
  · 一律输出 JPEG（不依赖原扩展名）
  · 缩略图宽度不超过 THUMB_WIDTH
  · 带透明通道的 PNG 压完不能变黑（要用白底填充）

测试图运行时生成，不依赖仓库素材，也不碰 media 目录。

用法：python scripts/test_image_service.py
"""
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.services.image_service import (  # noqa: E402
    JPEG_QUALITY,
    MAX_WIDTH,
    QUALITY_FLOOR,
    TARGET_MAX_BYTES,
    THUMB_WIDTH,
    compress_image,
    generate_thumbnail,
)

FAILS: list[str] = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(f"{label}: got={got!r} want={want!r}")


def check_true(label, cond, extra=""):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(f"{label} {extra}")


def make_noisy_jpeg(path: Path, w: int, h: int) -> None:
    """生成细节密集的大图（随机噪声最不容易压缩），用于压体积上限。

    用 numpy 一次性生成整块像素 —— 纯 Python 逐像素在 4096x2892 上要几分钟。
    """
    rng = np.random.default_rng(1234)
    arr = rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8)
    Image.fromarray(arr, "RGB").save(path, "JPEG", quality=95)


# 沙箱里系统临时目录不可写（TemporaryDirectory 清理会 PermissionError），
# 所以把工作目录放在仓库内的 backups/ 下，跑完手动清掉。
WORK = BACKEND / "backups" / "_imgtest"


def run() -> None:
    tmpdir = WORK

    print("=== 1. 常量合理性 ===")
    check_true(
        "TARGET_MAX_BYTES 在 200KB~2MB 之间",
        200 * 1024 <= TARGET_MAX_BYTES <= 2 * 1024 * 1024,
        f"实际={TARGET_MAX_BYTES}",
    )
    check_true("QUALITY_FLOOR <= JPEG_QUALITY", QUALITY_FLOOR <= JPEG_QUALITY)
    check_true("THUMB_WIDTH < MAX_WIDTH", THUMB_WIDTH < MAX_WIDTH)

    print("\n=== 2. 超宽图片会被缩到 MAX_WIDTH ===")
    src = tmpdir / "wide.jpg"
    make_noisy_jpeg(src, 4096, 2892)
    src_kb = src.stat().st_size / 1024
    dest = tmpdir / "wide_out.jpg"
    w, h = compress_image(src, dest)
    check("返回宽度 = MAX_WIDTH", w, MAX_WIDTH)
    with Image.open(dest) as im:
        check("文件真实宽度也 = MAX_WIDTH", im.width, MAX_WIDTH)
    check_true(
        "高度按比例缩放（允许 1px 舍入误差）",
        abs(h - 2892 * MAX_WIDTH / 4096) <= 1,
        f"got={h}",
    )
    out_kb = dest.stat().st_size / 1024
    print(f"       源图 {src_kb:.0f}KB -> 输出 {out_kb:.0f}KB")

    print("\n=== 3. 体积上限生效（噪声图最难压缩）===")
    check_true(
        f"输出 <= TARGET_MAX_BYTES（{TARGET_MAX_BYTES // 1024}KB）",
        dest.stat().st_size <= TARGET_MAX_BYTES,
        f"实际={dest.stat().st_size / 1024:.0f}KB",
    )

    print("\n=== 4. 小图不被放大 ===")
    small = tmpdir / "small.jpg"
    Image.new("RGB", (800, 600), (30, 60, 90)).save(small, "JPEG", quality=90)
    small_out = tmpdir / "small_out.jpg"
    w2, h2 = compress_image(small, small_out)
    check("宽度保持 800", w2, 800)
    check("高度保持 600", h2, 600)

    print("\n=== 5. 输出总是 JPEG（即使源是 PNG）===")
    png_src = tmpdir / "src.png"
    Image.new("RGB", (2400, 1600), (200, 30, 30)).save(png_src, "PNG")
    png_out = tmpdir / "from_png.jpg"
    compress_image(png_src, png_out)
    with Image.open(png_out) as im:
        check("输出格式", im.format, "JPEG")
        check("宽度 = MAX_WIDTH", im.width, MAX_WIDTH)

    print("\n=== 6. 透明 PNG 压完不变黑（白底填充）===")
    rgba = tmpdir / "alpha.png"
    img = Image.new("RGBA", (1200, 800), (255, 255, 255, 0))  # 全透明
    img.paste((0, 128, 255, 255), (400, 200, 800, 600))       # 中间一块蓝色
    img.save(rgba, "PNG")
    rgba_out = tmpdir / "alpha_out.jpg"
    compress_image(rgba, rgba_out)
    with Image.open(rgba_out) as im:
        corner = im.getpixel((5, 5))
        mid = im.getpixel((600, 400))
    check_true("透明角变成白色（不是黑色）", all(v > 240 for v in corner), f"corner={corner}")
    check_true("中间不透明区域仍是蓝色调", mid[2] > 200 and mid[0] < 60, f"mid={mid}")

    print("\n=== 7. 缩略图 ===")
    thumb_dest = tmpdir / "thumb.jpg"
    generate_thumbnail(dest, thumb_dest)
    with Image.open(thumb_dest) as im:
        check("缩略图宽度 = THUMB_WIDTH", im.width, THUMB_WIDTH)
        check("缩略图格式", im.format, "JPEG")
    check_true(
        "缩略图比原图小得多",
        thumb_dest.stat().st_size < dest.stat().st_size,
        f"thumb={thumb_dest.stat().st_size} dest={dest.stat().st_size}",
    )

    print("\n=== 8. 幂等：对已压缩的图再压一次宽度不变 ===")
    recomp = tmpdir / "recomp.jpg"
    w3, _ = compress_image(dest, recomp)
    check("宽度仍 = MAX_WIDTH", w3, MAX_WIDTH)


try:
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    run()
finally:
    shutil.rmtree(WORK, ignore_errors=True)

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] 图片压缩服务全部断言通过")
