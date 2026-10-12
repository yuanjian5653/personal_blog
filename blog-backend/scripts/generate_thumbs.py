"""
批量为已上传的图片生成缩略图
用法：python -m scripts.generate_thumbs
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings
from app.services.image_service import generate_thumbnail

SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def main():
    settings.THUMB_DIR.mkdir(parents=True, exist_ok=True)
    photos = list(settings.PHOTO_DIR.glob("*"))
    ok = 0
    fail = 0

    for src in photos:
        if not src.is_file():
            continue
        if src.suffix.lower() not in SUPPORTED:
            continue

        thumb = settings.THUMB_DIR / (src.stem + ".jpg")
        if thumb.exists():
            continue

        try:
            generate_thumbnail(src, thumb)
            ok += 1
            print(f"✅ {src.name}")
        except Exception as e:
            fail += 1
            print(f"❌ {src.name} - {e}")

    print(f"\n完成：成功 {ok}，失败 {fail}")


if __name__ == "__main__":
    main()