"""
图片处理服务
- 压缩原图到最大宽度（等比缩放）
- 生成缩略图
- 统一转成 JPEG，处理 EXIF 方向和透明背景

为什么要有体积上限（TARGET_MAX_BYTES）：
服务器公网带宽只有约 1Mbps（≈137KB/s），一张 3MB 的图要下 22 秒，
整页体感就被它拖死。只限制宽度不够 —— 1920 宽的细节密集型照片
在 q85 下仍可能到 1.5MB。所以这里再加一道"编码后仍超标就降质量"的兜底，
保证**经后台上传的图片一定不会大到拖慢首屏**。

注意：这个兜底只对走上传接口的图片生效。用文件管理器/scp 直接
丢进 media/photos 的文件不经过这里，需要另用 scripts/optimize_media.py。
"""
from pathlib import Path

from PIL import Image, ImageOps

MAX_WIDTH = 1920
THUMB_WIDTH = 600
JPEG_QUALITY = 85

# 压缩后仍超过这个体积就继续降质量重编码（相对 1Mbps 带宽约 6 秒）
TARGET_MAX_BYTES = 800 * 1024
# 质量下限：再低画质就明显崩了，宁可稍微超体积
QUALITY_FLOOR = 65


def _to_rgb(img: Image.Image) -> Image.Image:
    """把任意模式转成 RGB（处理透明背景）"""
    # 修 EXIF 方向
    img = ImageOps.exif_transpose(img)

    if img.mode == "P":
        img = img.convert("RGBA")
    if img.mode in ("RGBA", "LA"):
        # 用白色背景填充透明区
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
    return img


def compress_image(
    src_path: Path,
    dest_path: Path,
    max_width: int = MAX_WIDTH,
) -> tuple[int, int]:
    """压缩图片并保存为 JPEG，返回 (width, height)。

    两重约束：宽度不超过 max_width；编码后体积不超过 TARGET_MAX_BYTES
    （超过就按 10 一档降质量，最多降到 QUALITY_FLOOR）。
    """
    img = Image.open(src_path)
    img = _to_rgb(img)

    # 等比缩放
    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    quality = JPEG_QUALITY
    while True:
        img.save(dest_path, "JPEG", quality=quality, optimize=True)
        size = dest_path.stat().st_size
        if size <= TARGET_MAX_BYTES or quality <= QUALITY_FLOOR:
            break
        quality -= 10

    return img.size


def generate_thumbnail(
    src_path: Path,
    dest_path: Path,
    thumb_width: int = THUMB_WIDTH,
) -> None:
    """从已压缩的图生成缩略图（同样处理 RGBA）"""
    img = Image.open(src_path)
    img = _to_rgb(img)      # ← 关键：这里也加模式转换

    if img.width > thumb_width:
        ratio = thumb_width / img.width
        new_size = (thumb_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    img.save(dest_path, "JPEG", quality=JPEG_QUALITY, optimize=True)