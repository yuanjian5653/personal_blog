"""
图片组路由
公开：列表、详情
管理：创建、更新、删除、上传图片
"""
import logging
import random
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, select

from app.config import settings
from app.constants import IMAGE_EXTENSIONS
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, Album, Photo
from app.schemas.album import (
    AlbumCreate, AlbumDetail, AlbumRead, AlbumUpdate,
    PhotoRead,
)
from app.services.image_service import compress_image, generate_thumbnail
from app.services.log_service import apply_updates, log_operation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/albums", tags=["图片组"])


@router.get("", response_model=list[AlbumRead])
def list_albums(db: Session = Depends(get_session)):
    """图片组列表，包含最多 3 张预览图"""
    albums = db.exec(
        select(Album).order_by(Album.sort_order, Album.created_at.desc())
    ).all()

    result = []
    for a in albums:
        photos = db.exec(
            select(Photo)
            .where(Photo.album_id == a.id)
            .order_by(Photo.sort_order, Photo.created_at)
        ).all()

        item = AlbumRead.model_validate(a)
        item.photo_count = len(photos)

        # 封面兜底
        need_fallback = False
        if not item.cover_path:
            need_fallback = True
        else:
            cover_file = settings.PHOTO_DIR / item.cover_path
            if not cover_file.exists():
                need_fallback = True
        if need_fallback:
            item.cover_path = photos[0].file_path if photos else None

        # 随机选最多 3 张作为预览
        if photos:
            sample_size = min(3, len(photos))
            sampled = random.sample(photos, sample_size)
            item.preview_photos = [p.file_path for p in sampled]
        else:
            item.preview_photos = []

        result.append(item)
    return result


@router.get("/{album_id}", response_model=AlbumDetail)
def get_album(album_id: int, db: Session = Depends(get_session)):
    """图片组详情，包含全部图片"""
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="图片组不存在")

    photos = db.exec(
        select(Photo)
        .where(Photo.album_id == album_id)
        .order_by(Photo.sort_order, Photo.created_at)
    ).all()

    detail = AlbumDetail.model_validate(album)
    detail.photo_count = len(photos)
    detail.photos = [PhotoRead.model_validate(p) for p in photos]
    return detail


@router.post("", response_model=AlbumRead)
def create_album(
    data: AlbumCreate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """创建图片组（需登录）"""
    album = Album(**data.model_dump())
    db.add(album)
    db.flush()
    log_operation(
        db, current_admin.id, "create", "album", album.id,
        changes={"name": {"old": None, "new": album.name}},
    )
    db.commit()
    db.refresh(album)
    return AlbumRead.model_validate(album)


@router.put("/{album_id}", response_model=AlbumRead)
def update_album(
    album_id: int,
    data: AlbumUpdate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """更新图片组（需登录）"""
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="图片组不存在")

    update_data = data.model_dump(exclude_unset=True)
    apply_updates(db, album, update_data, current_admin.id, "album", album_id)

    db.commit()
    db.refresh(album)
    return AlbumRead.model_validate(album)


@router.delete("/{album_id}")
def delete_album(
    album_id: int,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """删除图片组（会一并删除其下所有照片记录，不删文件）"""
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="图片组不存在")

    # 先删照片
    for photo in db.exec(select(Photo).where(Photo.album_id == album_id)).all():
        db.delete(photo)

    log_operation(
        db, current_admin.id, "delete", "album", album_id,
        changes={"name": {"old": album.name, "new": None}},
    )
    db.delete(album)
    db.commit()
    return {"message": "已删除"}


@router.post("/{album_id}/photos", response_model=list[PhotoRead])
async def upload_photos(
    album_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    批量上传图片到指定图片组。
    - 原图自动压缩到最大 1920px 宽
    - 自动生成 600px 宽的缩略图
    - 统一转成 JPEG
    """
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="图片组不存在")

    existing = db.exec(select(Photo).where(Photo.album_id == album_id)).all()
    max_order = max((p.sort_order for p in existing), default=-1)

    # 确保目录存在
    settings.PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    settings.THUMB_DIR.mkdir(parents=True, exist_ok=True)

    created = []
    for file in files:
        original = Path(file.filename or "")
        ext = original.suffix.lower()
        if ext not in IMAGE_EXTENSIONS:
            continue

        # 统一用 .jpg 扩展名
        new_name = f"{uuid.uuid4().hex}.jpg"
        dest = settings.PHOTO_DIR / new_name
        thumb = settings.THUMB_DIR / new_name

        # 先写入临时文件
        tmp = settings.PHOTO_DIR / f"{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp, "wb") as f:
                while chunk := await file.read(1024 * 1024):
                    f.write(chunk)

            # 压缩 + 生成缩略图
            compress_image(tmp, dest)
            generate_thumbnail(dest, thumb)
        except Exception as e:
            logger.error("[上传] 图片处理失败 %s: %s", file.filename, e)
            continue
        finally:
            if tmp.exists():
                tmp.unlink()

        max_order += 1
        photo = Photo(
            album_id=album_id,
            file_path=new_name,
            title=original.stem,
            sort_order=max_order,
        )
        db.add(photo)
        created.append(photo)

    if not album.cover_path and created:
        album.cover_path = created[0].file_path
        db.add(album)

    db.commit()
    for p in created:
        db.refresh(p)

    return [PhotoRead.model_validate(p) for p in created]


@router.delete("/{album_id}/photos/{photo_id}")
def delete_photo(
    album_id: int,
    photo_id: int,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """从图片组删除一张照片记录（不删文件）"""
    photo = db.get(Photo, photo_id)
    if not photo or photo.album_id != album_id:
        raise HTTPException(status_code=404, detail="照片不存在")

    log_operation(
        db, current_admin.id, "delete", "photo", photo_id,
        changes={"file_path": {"old": photo.file_path, "new": None}},
    )
    db.delete(photo)
    db.commit()
    return {"message": "已删除"}