"""
上传配额模型 + 迁移。

为什么要单独一张表：
    photos 表只记录"相册里的照片"，而成员还能通过
    /api/upload/image、文章配图、说说配图等接口上传 —— 那些不产生 Photo 行。
    只数 photos 会漏掉大半，配额形同虚设。

    upload_logs 记录**每一次成功的上传**，按 admin_id + 时间统计即可。
"""
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._base import utcnow


class UploadLog(SQLModel, table=True):
    __tablename__ = "upload_logs"

    id: int | None = Field(default=None, primary_key=True)
    admin_id: int = Field(foreign_key="admin.id", index=True)
    # 上传来源：album / image / wallpaper …
    kind: str = Field(default="image", max_length=30)
    filename: str | None = Field(default=None, max_length=300)
    size: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow, index=True)
