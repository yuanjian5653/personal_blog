"""
网易云音乐公开接口代理
MUSIC_U 从数据库动态读取（可通过后台保存），不再只依赖 .env
"""
import os
import httpx
from sqlmodel import Session, select

BASE = "https://music.163.com"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://music.163.com/",
}


def get_music_u() -> str:
    """从数据库读 MUSIC_U，找不到回退 .env"""
    try:
        from app.database import engine
        from app.models import SiteConfig
        with Session(engine) as db:
            row = db.exec(
                select(SiteConfig).where(
                    SiteConfig.config_key == "netease_music_u"
                )
            ).first()
            if row and row.config_value:
                return row.config_value
    except Exception:
        pass
    return os.getenv("NETEASE_MUSIC_U", "")


def get_headers() -> dict:
    """每次请求前构造，动态带上 MUSIC_U"""
    headers = dict(DEFAULT_HEADERS)
    music_u = get_music_u()
    if music_u:
        headers["Cookie"] = f"MUSIC_U={music_u}"
    return headers


# 兼容旧代码里 `from app.services.netease import HEADERS`
HEADERS = DEFAULT_HEADERS


async def search_songs(keyword: str, limit: int = 10) -> list[dict]:
    async with httpx.AsyncClient(headers=get_headers(), timeout=10) as client:
        r = await client.get(
            f"{BASE}/api/search/get/web",
            params={"s": keyword, "type": 1, "limit": limit},
        )
        data = r.json()
        songs = data.get("result", {}).get("songs", [])
        return [
            {
                "id": s["id"],
                "name": s["name"],
                "artists": " / ".join(ar["name"] for ar in s.get("artists", [])),
                "album": s.get("album", {}).get("name", ""),
                "duration": s.get("duration", 0) // 1000,
            }
            for s in songs
        ]


async def get_playlist(playlist_id: int) -> dict:
    async with httpx.AsyncClient(headers=get_headers(), timeout=10) as client:
        r = await client.get(
            f"{BASE}/api/v6/playlist/detail",
            params={"id": playlist_id, "n": 1000, "s": 8},
        )
        data = r.json()
        playlist = data.get("playlist", {})
        track_ids = [t["id"] for t in playlist.get("trackIds", [])]
        return {
            "id": playlist.get("id"),
            "name": playlist.get("name"),
            "cover_url": playlist.get("coverImgUrl"),
            "description": playlist.get("description"),
            "creator": playlist.get("creator", {}).get("nickname"),
            "track_count": playlist.get("trackCount", 0),
            "track_ids": track_ids,
        }


async def get_song_detail(song_ids: list[int]) -> list[dict]:
    if not song_ids:
        return []
    result = []
    async with httpx.AsyncClient(headers=get_headers(), timeout=20) as client:
        for i in range(0, len(song_ids), 500):
            batch = song_ids[i : i + 500]
            c = "[" + ",".join('{"id":%d}' % x for x in batch) + "]"
            r = await client.post(f"{BASE}/api/v3/song/detail", data={"c": c})
            data = r.json()
            for s in data.get("songs", []):
                al = s.get("al") or {}
                result.append({
                    "id": s["id"],
                    "name": s.get("name", ""),
                    "artists": " / ".join(
                        ar.get("name", "") for ar in (s.get("ar") or [])
                    ),
                    "album": al.get("name", ""),
                    "cover_url": al.get("picUrl"),
                    "duration": (s.get("dt") or 0) // 1000,
                })
    return result


async def get_lyric(song_id: int) -> str:
    async with httpx.AsyncClient(headers=get_headers(), timeout=10) as client:
        r = await client.get(
            f"{BASE}/api/song/lyric",
            params={"id": song_id, "lv": 1, "kv": 1, "tv": 1},
        )
        data = r.json()
        lrc = (data.get("lrc") or {}).get("lyric", "") or ""
        tlyric = (data.get("tlyric") or {}).get("lyric", "") or ""
        return lrc if lrc.strip() else tlyric


async def get_account() -> dict | None:
    if not get_music_u():
        return None
    async with httpx.AsyncClient(headers=get_headers(), timeout=10) as client:
        r = await client.get(f"{BASE}/api/nuser/account/get")
        data = r.json()
        profile = data.get("profile")
        if not profile:
            return None
        return {
            "uid": profile.get("userId"),
            "nickname": profile.get("nickname"),
            "avatar": profile.get("avatarUrl"),
        }


async def get_my_playlists() -> list[dict]:
    account = await get_account()
    if not account:
        return []
    uid = account["uid"]
    async with httpx.AsyncClient(headers=get_headers(), timeout=15) as client:
        r = await client.get(
            f"{BASE}/api/user/playlist",
            params={"uid": uid, "limit": 1000, "offset": 0},
        )
        data = r.json()
        playlists = data.get("playlist", [])
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "cover_url": p.get("coverImgUrl"),
                "track_count": p.get("trackCount", 0),
                "creator": p.get("creator", {}).get("nickname"),
                "is_mine": p.get("userId") == uid,
            }
            for p in playlists
        ]


async def verify_music_u(cookie_value: str) -> dict:
    """验证一个 MUSIC_U 是否有效，返回账号信息"""
    headers = dict(DEFAULT_HEADERS)
    headers["Cookie"] = f"MUSIC_U={cookie_value}"
    async with httpx.AsyncClient(headers=headers, timeout=10) as client:
        r = await client.get(f"{BASE}/api/nuser/account/get")
        data = r.json()
        profile = data.get("profile")
        if not profile:
            return {"valid": False}
        return {
            "valid": True,
            "uid": profile.get("userId"),
            "nickname": profile.get("nickname"),
            "avatar": profile.get("avatarUrl"),
        }