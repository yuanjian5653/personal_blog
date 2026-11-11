"""
音乐相关路由
包含：歌曲列表、歌曲详情、音频流、播放计数、封面获取、成员上传
"""
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from sqlmodel import Session, func, select

from app.config import settings
from app.constants import AUDIO_EXTENSIONS
from app.database import get_session
from app.db_utils import count as db_count
from app.deps import (
    get_current_admin,
    get_current_admin_optional,
    require_content_owner,
)
from app.models import Admin, Song
from app.models.admin import DEFAULT_MEMBER_MUSIC_QUOTA
from app.schemas.music import SongRead
from app.services.log_service import log_operation
from app.services.metadata import calculate_file_hash, extract_metadata, get_content_type
from app.services.scanner import _index_file, scan_music_folder
from app.services.stream import stream_audio

# 扫描/上传共用的音频扩展名（constants 里叫 AUDIO_EXTENSIONS）
SUPPORTED_AUDIO_EXTENSIONS = AUDIO_EXTENSIONS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/music", tags=["音乐"])


@router.get("/songs", response_model=list[SongRead])
def list_songs(
    keyword: str | None = None,          # 可选搜索关键词
    limit: int = 100,
    offset: int = 0,
    mine: bool = False,                  # true = 只看自己上传的（后台）
    db: Session = Depends(get_session),
    viewer: Admin | None = Depends(get_current_admin_optional),
):
    """
    歌曲列表，支持关键词搜索和分页。

    参数:
        keyword: 搜索标题或艺术家（模糊匹配）
        limit: 每页数量
        offset: 偏移量
        mine: 只看自己的（后台用）。前台不传，返回全部
    """
    stmt = select(Song)

    if mine:
        if viewer is None:
            raise HTTPException(status_code=401, detail="未登录")
        stmt = stmt.where(Song.author_id == viewer.id)

    if keyword:
        # ilike 是"不区分大小写"的模糊匹配
        # %keyword% 表示前后都可以有任意字符
        pattern = f"%{keyword}%"
        stmt = stmt.where(
            (Song.title.ilike(pattern)) | (Song.artist.ilike(pattern))
        )

    stmt = stmt.order_by(Song.created_at.desc()).offset(offset).limit(limit)
    return db.exec(stmt).all()


@router.get("/songs/{song_id}", response_model=SongRead)
def get_song(song_id: int, db: Session = Depends(get_session)):
    """获取单首歌曲详情"""
    song = db.get(Song, song_id)
    # 成员只能删自己上传的；管理员不受限
    require_content_owner(current_admin, song.author_id) if song else None
    if not song:
        raise HTTPException(status_code=404, detail="歌曲不存在")
    return song


@router.get("/stream/{song_id}")
def stream_song(
    song_id: int,
    request: Request,
    db: Session = Depends(get_session),
):
    """
    音频流式接口。
    浏览器 <audio src="/api/music/stream/1"> 会请求这里。

    前端不需要处理 Range，浏览器自动发 Range 头，
    我们交给 stream_audio 处理。
    """
    song = db.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="歌曲不存在")

    # 数据库存的是相对路径，拼接出绝对路径
    file_path = settings.MUSIC_DIR / song.file_path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="音频文件丢失")

    return stream_audio(request, file_path, content_type=get_content_type(file_path))


@router.post("/songs/{song_id}/play")
def increment_play_count(song_id: int, db: Session = Depends(get_session)):
    """
    播放计数 +1。
    前端在开始播放时调用，用于"播放最多"排序。
    """
    song = db.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="歌曲不存在")
    song.play_count += 1
    db.add(song)
    db.commit()
    return {"message": "ok", "play_count": song.play_count}


@router.get("/cover/{song_id}")
def get_cover(song_id: int, db: Session = Depends(get_session)):
    """
    返回歌曲封面图片。
    如果数据库有 cover_path 就读文件，没有就返回 404。
    前端用 <img src="/api/music/cover/1"> 引用。
    """
    song = db.get(Song, song_id)
    if not song or not song.cover_path:
        raise HTTPException(status_code=404, detail="无封面")

    cover_file = settings.COVER_DIR / song.cover_path
    if not cover_file.exists():
        raise HTTPException(status_code=404, detail="封面文件丢失")

    return FileResponse(cover_file)




@router.get("/lyrics/{song_id}")
def get_lyrics(
    song_id: int,
    format: str = "json",
    db: Session = Depends(get_session),
):
    """
    返回 .lrc 歌词。
    - format=json（默认）：{"content": "...", "encoding": "..."}
    - format=text：直接返回纯文本，APlayer 用
    """
    song = db.get(Song, song_id)
    if not song or not song.lyrics_path:
        if format == "text":
            return PlainTextResponse("", media_type="text/plain; charset=utf-8")
        raise HTTPException(status_code=404, detail="无歌词")

    lyrics_file = settings.MUSIC_DIR / song.lyrics_path
    if not lyrics_file.exists():
        if format == "text":
            return PlainTextResponse("", media_type="text/plain; charset=utf-8")
        raise HTTPException(status_code=404, detail="歌词文件丢失")

    content = ""
    encoding_used = ""
    for encoding in ("utf-8", "gbk", "utf-16"):
        try:
            content = lyrics_file.read_text(encoding=encoding)
            encoding_used = encoding
            break
        except UnicodeDecodeError:
            continue
    else:
        if format == "text":
            return PlainTextResponse("", media_type="text/plain; charset=utf-8")
        raise HTTPException(status_code=500, detail="歌词文件编码无法识别")

    if format == "text":
        return PlainTextResponse(content, media_type="text/plain; charset=utf-8")
    return {"content": content, "encoding": encoding_used}

@router.post("/scan")
def trigger_scan(
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    手动触发全量扫描（需登录）。
    用于监控漏掉文件时补救。
    """
    stats = scan_music_folder()
    return {"message": "扫描完成", "stats": stats}


# 支持的音频扩展名见 app/constants.py（与扫描/元数据解析保持一致）


@router.delete("/songs/{song_id}")
def delete_song(
    song_id: int,
    delete_file: bool = False,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    删除歌曲。
    - delete_file=False（默认）：只删数据库记录
    - delete_file=True：同时删除磁盘文件和封面
    """
    song = db.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="歌曲不存在")

    # 成员只能删自己上传的；管理员不受限
    require_content_owner(current_admin, song.author_id)

    title = song.title

    # 删文件
    if delete_file:
        file_path = settings.MUSIC_DIR / song.file_path
        try:
            file_path.unlink(missing_ok=True)
        except OSError as e:
            logger.warning("[删除] 音频文件删除失败 %s: %s", file_path, e)

        if song.cover_path:
            cover_path = settings.COVER_DIR / song.cover_path
            try:
                cover_path.unlink(missing_ok=True)
            except OSError as e:
                logger.warning("[删除] 封面删除失败 %s: %s", cover_path, e)

    log_operation(
        db, current_admin.id, "delete", "song", song_id,
        changes={"title": {"old": title, "new": None}},
    )
    db.delete(song)
    db.commit()
    return {"message": "已删除", "deleted_file": delete_file}


def _music_quota(admin: Admin) -> int:
    """这个账号能上传几首本地音乐。0 = 不限。"""
    q = getattr(admin, "music_quota", None)
    if q is None:
        return DEFAULT_MEMBER_MUSIC_QUOTA
    return int(q)


def _music_count(db: Session, admin_id: int) -> int:
    return db_count(
        db.exec(
            select(func.count()).select_from(Song).where(Song.author_id == admin_id)
        ).one()
    )


@router.post("/upload", response_model=list[SongRead])
async def upload_songs(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """上传本地音乐文件（自动提取元数据入库）。

    成员也能用，但受 music_quota 限制（0 = 不限）。
    不做审核：传上去就能播；归属记在自己名下，
    后台「只看我的」只列自己的，删除也只能删自己的。

    逐首处理：某一首失败只跳过它，不影响同批的其它文件。
    """
    admin_id = int(current_admin.id or 0)
    quota = _music_quota(current_admin)
    created: list[Song] = []

    for file in files:
        # 配额（把本批已成功的也算进去）
        if quota > 0 and _music_count(db, admin_id) + len(created) >= quota:
            logger.info(
                "[上传] %s 已达上限 %d 首，跳过后续文件",
                current_admin.username,
                quota,
            )
            break

        original = Path(file.filename or "")
        ext = original.suffix.lower()
        if ext not in AUDIO_EXTENSIONS:
            logger.info("[上传] 跳过不支持的格式：%s", original.name)
            continue

        safe_name = original.name
        dest = settings.MUSIC_DIR / safe_name
        if dest.exists():
            safe_name = f"{original.stem}_{uuid.uuid4().hex[:8]}{ext}"
            dest = settings.MUSIC_DIR / safe_name

        with open(dest, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)

        try:
            song = _index_file(dest, db)
            if song:
                # 归属：统一盖上上传者
                song.author_id = admin_id
                db.add(song)
                created.append(song)
        except Exception as e:
            logger.error("[上传] 入库失败 %s: %s", safe_name, e)

    if created:
        db.commit()
        for s in created:
            db.refresh(s)
        logger.info("[上传] %s 上传了 %d 首", current_admin.username, len(created))

    return [SongRead.model_validate(s) for s in created]
