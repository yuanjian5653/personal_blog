"""
站点配置路由
- 配置读写
- 背景图列表与上传
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session

from app.config import settings
from app.constants import IMAGE_EXTENSIONS
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin
from app.schemas.site_config import SiteConfigResponse, SiteConfigUpdate
from app.services.log_service import log_operation
from app.services.site_config import get_all_configs, update_configs

router = APIRouter(prefix="/api/site-config", tags=["站点配置"])


@router.get("", response_model=SiteConfigResponse)
def read_configs(db: Session = Depends(get_session)):
    """读取全部站点配置（公开）"""
    return SiteConfigResponse(configs=get_all_configs(db))


@router.put("", response_model=SiteConfigResponse)
def write_configs(
    data: SiteConfigUpdate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """批量更新配置（需登录）"""
    old = get_all_configs(db)
    changes = {}
    for key, new_val in data.configs.items():
        if key in old and old[key] != new_val:
            changes[key] = {"old": old[key], "new": new_val}

    updated = update_configs(db, data.configs)

    if changes:
        log_operation(db, current_admin.id, "update", "site_config", None, changes)

    return SiteConfigResponse(configs=updated)


@router.get("/images")
def list_images():
    """
    列出 media/photos/ 下所有图片，供背景图选择器使用。
    返回相对 URL，前端拼上后端地址即可访问。
    """
    photos_dir = settings.PHOTO_DIR
    photos_dir.mkdir(parents=True, exist_ok=True)

    images = []
    for path in sorted(photos_dir.iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            images.append({
                "name": path.name,
                "url": f"/media/photos/{path.name}",
                "size": path.stat().st_size,
            })

    # 按文件名倒序，新上传的排在前面（文件名带时间戳/随机串）
    images.reverse()
    return {"images": images}


@router.post("/images/upload")
async def upload_image(
    file: UploadFile = File(...),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    上传背景图到 media/photos/。

    文件名用 uuid 重命名，避免：
    - 中文/空格文件名导致 URL 解析问题
    - 同名文件互相覆盖
    """
    # 检查扩展名
    original = Path(file.filename or "")
    ext = original.suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片格式，允许：{', '.join(sorted(IMAGE_EXTENSIONS))}",
        )

    # 生成新文件名
    new_name = f"{uuid.uuid4().hex}{ext}"
    dest = settings.PHOTO_DIR / new_name

    # 分块写入，避免大图占内存
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):  # 每次 1MB
            f.write(chunk)

    return {
        "name": new_name,
        "url": f"/media/photos/{new_name}",
        "size": dest.stat().st_size,
    }