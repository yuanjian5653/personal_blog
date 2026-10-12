"""
音频元数据提取服务
支持 MP3 和 M4A 两种格式。

两种格式的差异：
- MP3：ID3 标签，标题是 TIT2，艺术家是 TPE1，封面是 APIC
- M4A：MP4 容器，标题是 \xa9nam，艺术家是 \xa9ART，封面是 covr
  这些 \xa9 开头的 key 是 MP4 规范里 "©" 符号的转义写法
"""
import hashlib
from pathlib import Path
from typing import Any

from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover


def calculate_file_hash(file_path: Path, chunk_size: int = 8192) -> str:
    """计算文件 MD5 哈希，用于去重（分块读取，内存占用恒定）"""
    md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            md5.update(chunk)
    return md5.hexdigest()


def _extract_mp3(file_path: Path, result: dict) -> None:
    """
    解析 MP3 文件，把结果写入 result 字典。
    使用 ID3 标签体系。
    """
    audio = MP3(file_path)

    if audio.info:
        result["duration"] = round(audio.info.length, 2)
        if hasattr(audio.info, "bitrate"):
            result["bitrate"] = audio.info.bitrate // 1000

    tags = audio.tags
    if not tags:
        return

    # ID3 标签：帧名 → 字段
    if tags.get("TIT2"):
        result["title"] = str(tags["TIT2"])
    if tags.get("TPE1"):
        result["artist"] = str(tags["TPE1"])
    if tags.get("TALB"):
        result["album"] = str(tags["TALB"])
    if tags.get("TCON"):
        result["genre"] = str(tags["TCON"])
    if tags.get("TDRC"):
        year_str = str(tags["TDRC"])
        result["year"] = year_str[:4] if year_str else None

    # 封面：优先取 type=3（前封面）
    apic_list = tags.getall("APIC")
    if apic_list:
        front = next((t for t in apic_list if t.type == 3), apic_list[0])
        result["cover_data"] = front.data
        result["cover_mime"] = front.mime


def _extract_m4a(file_path: Path, result: dict) -> None:
    """
    解析 M4A 文件，把结果写入 result 字典。
    使用 MP4 标签体系。
    """
    audio = MP4(file_path)

    if audio.info:
        result["duration"] = round(audio.info.length, 2)
        if hasattr(audio.info, "bitrate"):
            result["bitrate"] = audio.info.bitrate // 1000

    tags = audio.tags
    if not tags:
        return

    # MP4 标签 key 是 \xa9 开头的四字符码（© 的转义）
    # \xa9nam = name, \xa9ART = artist, \xa9alb = album
    # \xa9gen = genre, \xa9day = date
    title = tags.get("\xa9nam")
    if title:
        result["title"] = str(title[0])

    artist = tags.get("\xa9ART")
    if artist:
        result["artist"] = str(artist[0])

    album = tags.get("\xa9alb")
    if album:
        result["album"] = str(album[0])

    genre = tags.get("\xa9gen")
    if genre:
        result["genre"] = str(genre[0])

    year = tags.get("\xa9day")
    if year:
        result["year"] = str(year[0])[:4]

    # 封面：covr 是一个列表，每项是 MP4Cover 对象
    covers = tags.get("covr")
    if covers:
        cover = covers[0]
        result["cover_data"] = bytes(cover)
        # MP4Cover 有 imageformat 属性：JPEG 或 PNG
        if cover.imageformat == MP4Cover.FORMAT_PNG:
            result["cover_mime"] = "image/png"
        else:
            result["cover_mime"] = "image/jpeg"


def extract_metadata(file_path: Path) -> dict[str, Any]:
    """
    根据文件扩展名选择解析器，提取音频元数据。

    返回字段与之前一致，额外支持 m4a。
    """
    result: dict[str, Any] = {
        "title": file_path.stem,
        "artist": "未知艺术家",
        "album": "未知专辑",
        "duration": 0.0,
        "genre": None,
        "year": None,
        "bitrate": None,
        "file_size": file_path.stat().st_size,
        "cover_data": None,
        "cover_mime": None,
    }

    suffix = file_path.suffix.lower()
    try:
        if suffix == ".mp3":
            _extract_mp3(file_path, result)
        elif suffix == ".m4a":
            _extract_m4a(file_path, result)
        # 其他格式暂不支持，返回兜底信息
    except Exception:
        # 文件损坏或格式异常时，返回已填充的兜底值
        pass

    return result


def find_lyrics_file(music_file: Path) -> Path | None:
    """查找同目录同名的 .lrc 歌词文件"""
    lrc_path = music_file.with_suffix(".lrc")
    return lrc_path if lrc_path.exists() else None


def get_content_type(file_path: Path) -> str:
    """
    根据扩展名返回正确的 MIME 类型。
    浏览器播放时靠这个决定用哪个解码器。
    """
    suffix = file_path.suffix.lower()
    if suffix == ".mp3":
        return "audio/mpeg"
    if suffix == ".m4a":
        return "audio/mp4"        # m4a 标准 MIME 是 audio/mp4
    return "application/octet-stream"