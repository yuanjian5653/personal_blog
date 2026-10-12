"""
网易云接口代理路由
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse,PlainTextResponse
from app.deps import get_current_admin
from app.models import Admin
from app.services.netease import (
    HEADERS,
    get_account,
    get_lyric,
    get_my_playlists,
    get_playlist,
    get_song_detail,
    search_songs,
)
from pydantic import BaseModel
from app.database import get_session
from sqlmodel import Session
from app.services.site_config import update_configs
from app.services.netease import verify_music_u

router = APIRouter(prefix="/api/netease", tags=["网易云"])


@router.get("/search")
async def api_search(
    keyword: str = Query(..., min_length=1),
    limit: int = 10,
    current_admin: Admin = Depends(get_current_admin),
):
    """搜索网易云歌曲"""
    return await search_songs(keyword, limit)


@router.get("/playlist/{playlist_id}")
async def api_playlist(
    playlist_id: int,
    current_admin: Admin = Depends(get_current_admin),
):
    """获取歌单基本信息 + 歌曲 ID 列表"""
    data = await get_playlist(playlist_id)
    if not data.get("id"):
        raise HTTPException(status_code=404, detail="歌单不存在或无法访问")
    return data


@router.get("/playlist/{playlist_id}/songs")
async def api_playlist_songs(
    playlist_id: int,
    current_admin: Admin = Depends(get_current_admin),
):
    """
    获取歌单里所有歌曲的详情（含封面）。
    分两步：先拿 track_ids，再批量查详情。
    """
    pl = await get_playlist(playlist_id)
    if not pl.get("track_ids"):
        return []
    return await get_song_detail(pl["track_ids"])


@router.get("/lyric/{song_id}")
async def api_lyric(
    song_id: int,
    format: str = "json",
):
    """获取歌词。format=text 时返回纯文本，APlayer 用"""
    lyric = await get_lyric(song_id)
    if format == "text":
        return PlainTextResponse(
            lyric or "", media_type="text/plain; charset=utf-8"
        )
    return {"lyric": lyric}


@router.get("/account")
async def api_account(
    current_admin: Admin = Depends(get_current_admin),
):
    """获取当前登录的网易云账号信息"""
    account = await get_account()
    if not account:
        return {"logged_in": False, "message": "未配置 NETEASE_MUSIC_U"}
    return {"logged_in": True, **account}


@router.get("/my-playlists")
async def api_my_playlists(
    current_admin: Admin = Depends(get_current_admin),
):
    """获取当前账号的所有歌单"""
    playlists = await get_my_playlists()
    return {"playlists": playlists}


@router.get("/stream/{song_id}")
async def stream_netease(song_id: int, request: Request):
    """
    代理网易云外链音频。

    注意：这个接口不校验管理员登录。
    因为前台的 <audio> 元素无法携带后台的 Session Cookie，
    如果加 Depends(get_current_admin) 会导致 403/401。
    个人博客场景，公开无妨。

    网易云外链会 302 到真实 CDN，我们用 httpx 跟随重定向并流式转发给前端。
    """
    outer_url = f"https://music.163.com/song/media/outer/url?id={song_id}.mp3"

    # 转发 Range 头，支持拖动进度条
    forward_headers = {
        "User-Agent": HEADERS["User-Agent"],
        "Referer": HEADERS["Referer"],
    }
    # 带上 MUSIC_U Cookie，部分歌曲需要登录才能取外链
    if "Cookie" in HEADERS:
        forward_headers["Cookie"] = HEADERS["Cookie"]

    if "range" in request.headers:
        forward_headers["Range"] = request.headers["range"]

    # 用 stream 模式请求，不一次性载入内存
    client = httpx.AsyncClient(timeout=None, follow_redirects=True)
    try:
        req = client.build_request("GET", outer_url, headers=forward_headers)
        resp = await client.send(req, stream=True)
    except Exception as e:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"网易云外链请求失败：{e}")

    # 网易云对 VIP 歌曲常返回 302 到一个 0 字节的 mp3，或直接 404
    if resp.status_code >= 400:
        await resp.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=404,
            detail="该歌曲无法播放（可能是 VIP 或版权限制）",
        )

    # 转发关键响应头，让浏览器能识别是音频并支持进度条
    out_headers = {}
    for k in (
        "Content-Type",
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
    ):
        if k in resp.headers:
            out_headers[k] = resp.headers[k]

    # 如果上游没返回 Content-Type 或不是音频，兜底为 audio/mpeg
    content_type = resp.headers.get("Content-Type", "audio/mpeg")
    if "audio" not in content_type and "octet-stream" not in content_type:
        # 网易云有时会返回 text/html 的错误页，视为播放失败
        await resp.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=404,
            detail="该歌曲无法播放（可能返回了非音频内容）",
        )

    async def iter_body():
        """流式转发内容，结束时清理连接"""
        try:
            async for chunk in resp.aiter_bytes(64 * 1024):
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(
        iter_body(),
        status_code=resp.status_code,
        headers=out_headers,
        media_type=content_type,
    )




class CookiePayload(BaseModel):
    music_u: str


@router.post("/cookie")
async def save_cookie(
    payload: CookiePayload,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    保存新的 MUSIC_U cookie。
    先验证有效，再写入配置。
    """
    music_u = payload.music_u.strip()
    if not music_u:
        raise HTTPException(400, "cookie 不能为空")

    # 验证
    result = await verify_music_u(music_u)
    if not result.get("valid"):
        raise HTTPException(
            400, "MUSIC_U 无效或已过期，请重新从浏览器复制"
        )

    # 保存
    update_configs(db, {"netease_music_u": music_u})

    return {
        "success": True,
        "nickname": result.get("nickname"),
        "avatar": result.get("avatar"),
    }