from datetime import datetime
from pydantic import BaseModel, Field


class PhotoRead(BaseModel):
    id: int
    album_id: int
    file_path: str
    title: str | None = None
    description: str | None = None
    sort_order: int
    created_at: datetime
    # 内容作者（成员标签用）。列表接口只给 id，
    # 显示名和头像由前端通过 GET /api/authors 一次性取回后本地关联。
    author_id: int | None = None

    class Config:
        from_attributes = True
    review_status: str = "approved"
    status: str = "published"
    review_note: str | None = None

class AlbumRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    cover_path: str | None = None
    date_label: str | None = None
    sort_order: int
    photo_count: int = 0          # 组内图片数
    preview_photos: list[str] = []  # ← 新增：最多 3 张预览图
    created_at: datetime
    # 内容作者（成员标签用）。列表接口只给 id，
    # 显示名和头像由前端通过 GET /api/authors 一次性取回后本地关联。
    author_id: int | None = None

    class Config:
        from_attributes = True


class AlbumDetail(AlbumRead):
    photos: list[PhotoRead] = []
    # 内容作者（成员标签用）。列表接口只给 id，
    # 显示名和头像由前端通过 GET /api/authors 一次性取回后本地关联。
    author_id: int | None = None


class AlbumCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    date_label: str | None = None
    cover_path: str | None = None


class AlbumUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    date_label: str | None = None
    cover_path: str | None = None
    sort_order: int | None = None


class PhotoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    sort_order: int | None = None