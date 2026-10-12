"""
歌单路由
包含：歌单 CRUD、歌单内歌曲管理
"""
# db.flush() 生成 ID 但不提交，用于日志记录关联 ID。
# model_dump(exclude_unset=True) 只取前端实际传了的字段，避免把未传字段误判为“改为 None”。
# 歌单的读操作不要求登录（公开），写操作全部 Depends(get_current_admin)。


from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.models import Admin, Playlist, PlaylistSong, Song
from app.deps import get_current_admin
from app.schemas.music import (
    AddSongsRequest,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistRead,
    PlaylistUpdate,
    SongRead,
)
from app.services.log_service import apply_updates, log_operation

router = APIRouter(prefix="/api/playlists", tags=["歌单"])


@router.get("", response_model=list[PlaylistRead])
def list_playlists(db: Session = Depends(get_session)):
    """歌单列表（公开）"""
    stmt = select(Playlist).order_by(Playlist.sort_order, Playlist.created_at)
    return db.exec(stmt).all()


@router.get("/{playlist_id}", response_model=PlaylistDetail)
def get_playlist(playlist_id: int, db: Session = Depends(get_session)):
    """
    歌单详情，包含歌曲列表。

    流程:
    1. 查歌单
    2. 通过中间表查出所有 song_id（按 sort_order 排序）
    3. 按 song_id 查出 Song 对象列表
    """
    playlist = db.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="歌单不存在")

    # 查中间表，按 sort_order 排序
    stmt = (
        select(PlaylistSong)
        .where(PlaylistSong.playlist_id == playlist_id)
        .order_by(PlaylistSong.sort_order)
    )
    links = db.exec(stmt).all()

    songs = []
    for link in links:
        song = db.get(Song, link.song_id)
        if song:
            songs.append(SongRead.model_validate(song))

    return PlaylistDetail(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        cover_path=playlist.cover_path,
        sort_order=playlist.sort_order,
        songs=songs,
    )


@router.post("", response_model=PlaylistRead)
def create_playlist(
    data: PlaylistCreate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """创建歌单（需登录）"""
    playlist = Playlist(name=data.name, description=data.description)
    db.add(playlist)
    db.flush()          # flush 让 playlist.id 生成，但还没提交

    log_operation(
        db, current_admin.id, "create", "playlist",
        target_id=playlist.id,
        changes={"name": {"old": None, "new": data.name}},
    )
    db.commit()
    db.refresh(playlist)
    return playlist


@router.put("/{playlist_id}", response_model=PlaylistRead)
def update_playlist(
    playlist_id: int,
    data: PlaylistUpdate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """更新歌单（需登录）"""
    playlist = db.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="歌单不存在")

    # 只取前端实际传了的字段，避免把未传字段误判为“改为 None”
    update_data = data.model_dump(exclude_unset=True)
    apply_updates(db, playlist, update_data, current_admin.id, "playlist", playlist_id)

    db.commit()
    db.refresh(playlist)
    return playlist


@router.delete("/{playlist_id}")
def delete_playlist(
    playlist_id: int,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """删除歌单（需登录），同时删除中间表关联"""
    playlist = db.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="歌单不存在")

    # 先删中间表记录
    stmt = select(PlaylistSong).where(PlaylistSong.playlist_id == playlist_id)
    for link in db.exec(stmt).all():
        db.delete(link)

    log_operation(
        db, current_admin.id, "delete", "playlist", playlist_id,
        changes={"name": {"old": playlist.name, "new": None}},
    )
    db.delete(playlist)
    db.commit()
    return {"message": "已删除"}


@router.post("/{playlist_id}/songs")
def add_songs_to_playlist(
    playlist_id: int,
    data: AddSongsRequest,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    向歌单添加歌曲。
    data.song_ids 是歌曲 ID 列表，一次可加多首。
    """
    playlist = db.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="歌单不存在")

    # 查当前歌单已有的歌，避免重复添加
    existing = db.exec(
        select(PlaylistSong).where(PlaylistSong.playlist_id == playlist_id)
    ).all()
    existing_song_ids = {link.song_id for link in existing}

    # 当前最大排序值，新加的往后排
    max_order = max((link.sort_order for link in existing), default=-1)

    added = 0
    for song_id in data.song_ids:
        if song_id in existing_song_ids:
            continue                    # 已存在，跳过
        if not db.get(Song, song_id):
            continue                    # 歌曲不存在，跳过
        max_order += 1
        link = PlaylistSong(
            playlist_id=playlist_id,
            song_id=song_id,
            sort_order=max_order,
        )
        db.add(link)
        added += 1

    log_operation(
        db, current_admin.id, "update", "playlist", playlist_id,
        changes={"added_songs": {"old": None, "new": data.song_ids}},
    )
    db.commit()
    return {"message": f"添加了 {added} 首歌曲"}


@router.delete("/{playlist_id}/songs/{song_id}")
def remove_song_from_playlist(
    playlist_id: int,
    song_id: int,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """从歌单移除歌曲（不删除歌曲本身）"""
    stmt = select(PlaylistSong).where(
        PlaylistSong.playlist_id == playlist_id,
        PlaylistSong.song_id == song_id,
    )
    link = db.exec(stmt).first()
    if not link:
        raise HTTPException(status_code=404, detail="该歌曲不在此歌单")

    log_operation(
        db, current_admin.id, "update", "playlist", playlist_id,
        changes={"removed_song_id": {"old": song_id, "new": None}},
    )
    db.delete(link)
    db.commit()
    return {"message": "已移除"}