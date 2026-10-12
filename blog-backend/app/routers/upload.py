"""
通用图片上传接口
"""
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import settings
from app.constants import IMAGE_EXTENSIONS
from app.deps import get_current_admin
from app.models import Admin
from app.services.image_service import compress_image, generate_thumbnail

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload", tags=["上传"])


async def _save_and_compress(file: UploadFile) -> dict:
    """保存 + 压缩 + 生成缩略图"""
    original = Path(file.filename or "")
    ext = original.suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(400, f"不支持的格式：{ext}")

    # 统一用 .jpg 存
    new_name = f"{uuid.uuid4().hex}.jpg"
    dest = settings.PHOTO_DIR / new_name
    thumb = settings.THUMB_DIR / new_name

    # 先写临时文件
    tmp = settings.PHOTO_DIR / f"{uuid.uuid4().hex}.tmp"

    try:
        with open(tmp, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
        compress_image(tmp, dest)
        generate_thumbnail(dest, thumb)
    except Exception as e:
        raise HTTPException(500, f"图片处理失败：{e}")
    finally:
        if tmp.exists():
            tmp.unlink()

    return {
        "name": new_name,
        "url": f"/media/photos/{new_name}",
        "thumb_url": f"/media/thumbs/{new_name}",
        "size": dest.stat().st_size,
    }


@router.post("/image")
async def upload_single(
    file: UploadFile = File(...),
    current_admin: Admin = Depends(get_current_admin),
):
    """单图上传"""
    return await _save_and_compress(file)


@router.post("/images")
async def upload_multiple(
    files: list[UploadFile] = File(...),
    current_admin: Admin = Depends(get_current_admin),
):
    """多图上传"""
    results = []
    for f in files:
        try:
            results.append(await _save_and_compress(f))
        except Exception as e:
            logger.error("[上传] %s 失败：%s", f.filename, e)
            continue
    return results