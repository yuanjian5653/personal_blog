"""
图片处理服务
- 压缩原图到最大宽度（等比缩放）
- 生成缩略图
- 统一转成 JPEG，处理 EXIF 方向和透明背景
"""
from pathlib import Path
from PIL import Image, ImageOps

MAX_WIDTH = 1920
THUMB_WIDTH = 600
JPEG_QUALITY = 85


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
    """压缩图片并保存为 JPEG，返回 (width, height)"""
    img = Image.open(src_path)
    img = _to_rgb(img)

    # 等比缩放
    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    img.save(dest_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
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