"""
歌曲模型
对应数据库 songs 表，存储音频文件的元数据和文件路径。

file_path 用相对路径，将来项目整体搬到别的盘符也不会失效。
file_hash 做去重，比路径更可靠。
play_count 为“播放最多”排序预留。
"""
from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class Song(SQLModel, table=True):
    __tablename__ = "songs"

    id: int | None = Field(default=None, primary_key=True)

    # ---- 元数据（从音频文件里提取）----
    title: str = Field(max_length=255, index=True)        # 标题，支持索引方便搜索
    artist: str = Field(default="未知艺术家", max_length=255)
    album: str = Field(default="未知专辑", max_length=255)
    duration: float = Field(default=0.0)                  # 时长（秒），浮点保留小数

    # ---- 文件信息 ----
    # file_path 存相对于 media/music 的相对路径，例如 "周杰伦/七里香.mp3"
    # 不存绝对路径，方便项目整体迁移
    file_path: str = Field(unique=True, index=True, max_length=500)

    # file_hash 用文件内容 MD5，用于去重：
    # 同一个文件被拖进目录两次、或改文件名后重复扫描，都能识别出来
    file_hash: str = Field(unique=True, index=True, max_length=64)

    # ---- 封面和歌词 ----
    cover_path: str | None = Field(default=None, max_length=500)   # 提取或上传的封面
    lyrics_path: str | None = Field(default=None, max_length=500)  # .lrc 文件路径

    # ---- 扩展元数据（文件里可能有，也可能没有）----
    genre: str | None = Field(default=None, max_length=100)  # 流派
    year: str | None = Field(default=None, max_length=10)    # 年份
    bitrate: int | None = Field(default=None)                # 码率 kbps
    file_size: int | None = Field(default=None)              # 文件大小（字节）

    # ---- 统计 ----
    play_count: int = Field(default=0)                       # 播放次数

    # ---- 时间戳 ----
    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow)
