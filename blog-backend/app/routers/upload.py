"""
通用图片上传接口
"""
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import settings
from app.constants import IMAGE_EXTENSIONS
from sqlmodel import Session
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin
from app.services.image_service import compress_image, generate_thumbnail
from app.services.quota import ensure_upload_quota, record_upload

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
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """单图上传"""
    ensure_upload_quota(db, current_admin)
    result = await _save_and_compress(file)
    record_upload(db, int(current_admin.id or 0), "image", result.get("name"), result.get("size") or 0)
    db.commit()
    return result


@router.post("/images")
async def upload_multiple(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """多图上传"""
    ensure_upload_quota(db, current_admin)
    results = []
    for f in files:
        try:
            results.append(await _save_and_compress(f))
        except Exception as e:
            logger.error("[上传] %s 失败：%s", f.filename, e)
            continue
    for item in results:
        record_upload(db, int(current_admin.id or 0), "image", item.get("name"), item.get("size") or 0)
    if results:
        db.commit()
    return results


# ============================================================
# 动态壁纸（暗号彩蛋用）
# ============================================================

# 允许的格式 → (asset_kind, 说明)
WALLPAPER_EXTENSIONS = {
    ".mp4": "video",
    ".webm": "video",
    ".gif": "image",
    ".webp": "image",
}

# 硬上限 8 MB。为什么不转码：服务器 1.6G 内存装不下 ffmpeg，转码也很吃 CPU。
# 推荐值 3 MB 以内 —— 出站只有 1 Mbps，壁纸太大会拖慢访客。
WALLPAPER_MAX_BYTES = 8 * 1024 * 1024
WALLPAPER_RECOMMEND_BYTES = 3 * 1024 * 1024


@router.post("/wallpaper")
async def upload_wallpaper(
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """上传动态壁纸（原样保存，不压缩不转码）。

    返回 `asset_kind` 让前台决定用 <video> 还是 <img>。
    """
    ensure_upload_quota(db, current_admin)
    original = Path(file.filename or "")
    ext = original.suffix.lower()
    if ext not in WALLPAPER_EXTENSIONS:
        raise HTTPException(
            400,
            f"不支持的格式：{ext or '(无扩展名)'}。"
            f"可用：{', '.join(sorted(WALLPAPER_EXTENSIONS))}",
        )

    asset_kind = WALLPAPER_EXTENSIONS[ext]
    new_name = f"{uuid.uuid4().hex}{ext}"
    dest = settings.WALLPAPER_DIR / new_name
    tmp = settings.WALLPAPER_DIR / f"{uuid.uuid4().hex}.tmp"

    total = 0
    try:
        with open(tmp, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > WALLPAPER_MAX_BYTES:
                    raise HTTPException(
                        400,
                        f"文件太大（超过 {WALLPAPER_MAX_BYTES // 1024 // 1024} MB）。"
                        "建议压到 3 MB 以内 —— 服务器出站只有 1 Mbps。",
                    )
                f.write(chunk)

        if total == 0:
            raise HTTPException(400, "文件是空的")

        tmp.replace(dest)
    except HTTPException:
        if tmp.exists():
            tmp.unlink()
        raise
    except Exception as e:
        if tmp.exists():
            tmp.unlink()
        raise HTTPException(500, f"保存失败：{e}")

    warn = None
    if total > WALLPAPER_RECOMMEND_BYTES:
        warn = (
            f"文件 {total / 1024 / 1024:.1f} MB，超过推荐的 3 MB。"
            "访客加载会比较慢（服务器出站 1 Mbps）。"
        )

    logger.info("[上传] 壁纸 %s（%.1f KB）", new_name, total / 1024)

    return {
        "name": new_name,
        "url": f"/media/wallpapers/{new_name}",
        "asset_kind": asset_kind,
        "size": total,
        "warning": warn,
    }
