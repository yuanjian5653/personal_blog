"""
音乐扫描服务
职责：
1. 扫描 media/music/ 目录，把新增 MP3 入库
2. 清理数据库里已不存在的文件记录
3. 被 watchdog 事件和手动扫描接口共用
"""
# _pending_timers 是防抖核心：文件拷贝会触发多次事件，延迟 1 秒合并成一次。
# schedule_index 用 threading.Timer 而不是 time.sleep，避免阻塞事件线程。
# daemon=True 保证程序退出时定时器不会阻止退出。

import logging
import threading
from pathlib import Path

from sqlmodel import Session, select

from app.config import settings
from app.constants import SUPPORTED_AUDIO_EXTENSIONS
from app.database import engine
from app.models import Song
from app.services.metadata import (
    calculate_file_hash,
    extract_metadata,
    find_lyrics_file,
)

logger = logging.getLogger(__name__)

# 防抖字典：记录每个文件最后一次事件的时间
# 文件正在被拷贝时会触发多次事件，用这个避免重复处理
_pending_timers: dict[str, threading.Timer] = {}
_timer_lock = threading.Lock()


def _save_cover(file_hash: str, cover_data: bytes, mime: str) -> str | None:
    """
    把内嵌封面写进 covers 目录，返回文件名。

    参数:
        file_hash: 歌曲的文件哈希，用作封面文件名（保证唯一）
        cover_data: 封面二进制数据
        mime: MIME 类型，如 "image/jpeg"

    返回:
        封面文件名（不含目录），如 "abc123.jpg"；无封面返回 None
    """
    if not cover_data:
        return None

    # 根据 MIME 决定扩展名
    ext = ".jpg"
    if "png" in mime:
        ext = ".png"
    elif "webp" in mime:
        ext = ".webp"
    elif "gif" in mime:
        ext = ".gif"

    cover_name = f"{file_hash}{ext}"
    cover_path = settings.COVER_DIR / cover_name

    # 已存在就不重复写（同一首歌反复扫描）
    if not cover_path.exists():
        cover_path.write_bytes(cover_data)

    return cover_name


def _index_file(file_path: Path, db: Session) -> Song | None:
    """
    处理单个 MP3 文件：提取元数据、去重、入库。

    参数:
        file_path: MP3 绝对路径
        db: 数据库 Session

    返回:
        新增或已存在的 Song 对象；失败返回 None
    """
    try:
        # ---- 1. 计算哈希用于去重 ----
        file_hash = calculate_file_hash(file_path)

        # 已存在同样的哈希 → 跳过（可能是同一个文件换了名字）
        existing = db.exec(select(Song).where(Song.file_hash == file_hash)).first()
        if existing:
            return existing

        # ---- 2. 提取元数据 ----
        meta = extract_metadata(file_path)

        # ---- 3. 存封面 ----
        cover_name = _save_cover(file_hash, meta["cover_data"], meta["cover_mime"] or "")

        # ---- 4. 查歌词文件 ----
        lyrics_file = find_lyrics_file(file_path)
        # 数据库存相对 MUSIC_DIR 的路径
        rel_path = file_path.relative_to(settings.MUSIC_DIR).as_posix()
        lyrics_rel = (
            lyrics_file.relative_to(settings.MUSIC_DIR).as_posix()
            if lyrics_file
            else None
        )

        # ---- 5. 创建 Song 记录 ----
        song = Song(
            title=meta["title"],
            artist=meta["artist"],
            album=meta["album"],
            duration=meta["duration"],
            file_path=rel_path,
            file_hash=file_hash,
            cover_path=cover_name,
            lyrics_path=lyrics_rel,
            genre=meta["genre"],
            year=meta["year"],
            bitrate=meta["bitrate"],
            file_size=meta["file_size"],
        )
        db.add(song)
        db.commit()
        db.refresh(song)

        logger.info(f"[扫描] 新增歌曲：{song.title} - {song.artist}")
        return song

    except Exception as e:
        # 单个文件失败不影响其他文件
        logger.error(f"[扫描] 处理失败 {file_path.name}: {e}")
        db.rollback()
        return None


def scan_music_folder() -> dict:
    """
    全量扫描 media/music/，做三件事：
    1. 新增：目录里有、数据库没有 → 入库
    2. 删除：数据库有、目录里没有 → 删记录
    3. 清理孤儿封面

    返回:
        统计信息 {"added": n, "removed": n, "total": n}
    """
    logger.info("[扫描] 开始全量扫描音乐目录")
    added = 0
    removed = 0

    with Session(engine) as db:
        # ---- 1. 收集磁盘上所有 MP3 的相对路径和哈希 ----
        disk_files: dict[str, Path] = {}
        if settings.MUSIC_DIR.exists():
            for path in settings.MUSIC_DIR.rglob("*"):
                if path.is_file() and path.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS:
                    rel = path.relative_to(settings.MUSIC_DIR).as_posix()
                    disk_files[rel] = path

        # ---- 2. 新增不在数据库里的文件 ----
        for rel_path, abs_path in disk_files.items():
            exists = db.exec(select(Song).where(Song.file_path == rel_path)).first()
            if not exists:
                if _index_file(abs_path, db):
                    added += 1

        # ---- 3. 删除数据库里有但磁盘没有的记录 ----
        all_songs = db.exec(select(Song)).all()
        for song in all_songs:
            abs_path = settings.MUSIC_DIR / song.file_path
            if not abs_path.exists():
                # 顺手删掉封面文件
                if song.cover_path:
                    cover_file = settings.COVER_DIR / song.cover_path
                    if cover_file.exists():
                        cover_file.unlink()
                db.delete(song)
                removed += 1
                logger.info(f"[扫描] 移除失效歌曲：{song.title}")

        db.commit()
        total = len(db.exec(select(Song)).all())

    logger.info(f"[扫描] 完成：新增 {added}，移除 {removed}，总计 {total}")
    return {"added": added, "removed": removed, "total": total}


def index_single_file(file_path: Path):
    """
    处理单个文件（watchdog 新增事件调用）。
    自己创建 Session，因为 watchdog 在独立线程里。
    """
    if file_path.suffix.lower() not in SUPPORTED_AUDIO_EXTENSIONS:
        return
    if not file_path.exists():
        return

    with Session(engine) as db:
        _index_file(file_path, db)


def remove_single_file(file_path: Path):
    """
    从数据库移除单个文件（watchdog 删除事件调用）。
    """
    try:
        rel_path = file_path.relative_to(settings.MUSIC_DIR).as_posix()
    except ValueError:
        return

    with Session(engine) as db:
        song = db.exec(select(Song).where(Song.file_path == rel_path)).first()
        if song:
            if song.cover_path:
                cover_file = settings.COVER_DIR / song.cover_path
                if cover_file.exists():
                    cover_file.unlink()
            db.delete(song)
            db.commit()
            logger.info(f"[监控] 移除歌曲：{song.title}")


def schedule_index(file_path: Path, delay: float = 1.0):
    """
    延迟处理文件事件，做防抖。

    为什么需要防抖？
    文件从别的盘拷进来时，watchdog 会连续触发多个 created/modified 事件，
    如果每个都立即处理，会在文件还没拷完时尝试读取，导致失败。
    延迟 1 秒，如果这期间又有新事件，就取消旧的定时器重新计时。
    """
    key = str(file_path)

    with _timer_lock:
        # 取消上一个定时器
        old_timer = _pending_timers.get(key)
        if old_timer:
            old_timer.cancel()

        # 新建一个定时器，delay 秒后执行
        timer = threading.Timer(delay, _do_index, args=(file_path,))
        timer.daemon = True       # 主线程退出时自动结束
        timer.start()
        _pending_timers[key] = timer


def _do_index(file_path: Path):
    """定时器回调：真正执行入库，并清理字典"""
    try:
        index_single_file(file_path)
    finally:
        with _timer_lock:
            _pending_timers.pop(str(file_path), None)