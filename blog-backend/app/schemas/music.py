"""
音乐相关的请求/响应 Schema
"""
# from_attributes = True 让 Pydantic 可以从 SQLModel 的 ORM 对象直接构造（Pydantic v2 语法）。
# SongRead 不含 file_path 和 file_hash，避免暴露本地路径。


from datetime import datetime
from pydantic import BaseModel, Field


class SongRead(BaseModel):
    """返回给前端的歌曲信息"""
    id: int
    title: str
    artist: str
    album: str
    duration: float
    cover_path: str | None = None
    lyrics_path: str | None = None
    genre: str | None = None
    year: str | None = None
    bitrate: int | None = None
    file_size: int | None = None
    play_count: int
    created_at: datetime

    class Config:
        from_attributes = True      # 允许从 ORM 对象转换


class PlaylistRead(BaseModel):
    """歌单基本信息"""
    id: int
    name: str
    description: str | None = None
    cover_path: str | None = None
    sort_order: int


class PlaylistDetail(PlaylistRead):
    """歌单详情：带歌曲列表"""
    songs: list[SongRead] = []


class PlaylistCreate(BaseModel):
    """创建歌单请求体"""
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class PlaylistUpdate(BaseModel):
    """更新歌单请求体（字段都可选）"""
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None


class AddSongsRequest(BaseModel):
    """向歌单添加歌曲的请求体"""
    song_ids: list[int] = Field(..., min_length=1)