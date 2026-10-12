"""
歌单模型
包含两个表：
- playlists: 歌单本身
- playlist_songs: 歌单与歌曲的多对多关联，带排序字段
"""
from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class Playlist(SQLModel, table=True):
    __tablename__ = "playlists"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=100, index=True)
    description: str | None = Field(default=None, max_length=500)
    cover_path: str | None = Field(default=None, max_length=500)
    sort_order: int = Field(default=0)          # 手动排序用
    created_at: datetime = Field(default_factory=utcnow)


class PlaylistSong(SQLModel, table=True):
    """
    歌单-歌曲关联表（多对多中间表）。
    Song 和 Playlist 是"多对多"关系：
    - 一首歌可以属于多个歌单
    - 一个歌单包含多首歌
    中间表额外带 sort_order，记录歌曲在歌单中的顺序。
    """
    __tablename__ = "playlist_songs"

    id: int | None = Field(default=None, primary_key=True)
    playlist_id: int = Field(foreign_key="playlists.id", index=True)
    song_id: int = Field(foreign_key="songs.id", index=True)
    sort_order: int = Field(default=0)          # 歌单内排序
    added_at: datetime = Field(default_factory=utcnow)
