"""
Range 流式传输服务
浏览器播放音频时会发送 Range 请求头，服务端必须支持分段返回，
否则进度条无法拖动、无法断点续播。
"""
import re
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException, Request, status
from fastapi.responses import StreamingResponse

# 匹配 "bytes=0-1023" 或 "bytes=1000-" 或 "bytes=-500"
# 分组 1: 起始位置，分组 2: 结束位置
RANGE_PATTERN = re.compile(r"bytes=(\d*)-(\d*)")


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    """
    解析 Range 请求头，返回 (start, end) 闭区间。

    支持的格式：
    - "bytes=0-1023"  → start=0, end=1023
    - "bytes=1000-"   → start=1000, end=file_size-1（从 1000 到末尾）
    - "bytes=-500"    → 最后 500 字节，start=file_size-500, end=file_size-1

    参数:
        range_header: 浏览器发送的 Range 头，例如 "bytes=0-1023"
        file_size: 文件总大小（字节）

    返回:
        (start, end)，均为闭区间下标（包含 end）

    异常:
        格式不合法或超出范围时抛 HTTPException 416
    """
    match = RANGE_PATTERN.match(range_header)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Range 格式不合法",
        )

    start_str, end_str = match.groups()

    if start_str == "" and end_str == "":
        # "bytes=-" 这种既没起点又没终点，非法
        raise HTTPException(status_code=416, detail="Range 格式不合法")

    if start_str == "":
        # "bytes=-500"：最后 N 字节
        suffix_length = int(end_str)
        if suffix_length <= 0:
            raise HTTPException(status_code=416, detail="Range 不合法")
        start = max(0, file_size - suffix_length)
        end = file_size - 1
    else:
        start = int(start_str)
        if end_str == "":
            # "bytes=1000-"：从 1000 到文件末尾
            end = file_size - 1
        else:
            end = int(end_str)

    # 边界检查
    if start >= file_size or start > end:
        raise HTTPException(
            status_code=416,
            detail=f"请求范围超出文件大小（{file_size} 字节）",
        )
    # end 不能超过文件末尾
    end = min(end, file_size - 1)

    return start, end


def iter_file_range(file_path: Path, start: int, end: int, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
    """
    生成器：按块读取文件的指定区间。

    为什么用生成器而不是一次性读完？
    - 一个 10MB 的音频分 160 次读取，每次 64KB
    - 内存占用恒定 64KB，不随文件大小增长
    - StreamingResponse 会在客户端消费时才推数据

    参数:
        file_path: 文件路径
        start: 起始字节位置（含）
        end: 结束字节位置（含）
        chunk_size: 每次读取的字节数，默认 64KB

    生成:
        一段段 bytes 数据
    """
    remaining = end - start + 1        # 总字节数
    with open(file_path, "rb") as f:
        f.seek(start)                  # 定位到起始位置
        while remaining > 0:
            # 每次最多读 chunk_size，剩余不足就只读剩余的
            read_size = min(chunk_size, remaining)
            chunk = f.read(read_size)
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def stream_audio(request: Request, file_path: Path, content_type: str = "audio/mpeg") -> StreamingResponse:
    """
    返回音频文件的流式响应，自动处理 Range 请求。

    参数:
        request: FastAPI 的 Request 对象，用来读取 Range 头
        file_path: 音频文件路径
        content_type: MIME 类型，MP3 是 "audio/mpeg"

    返回:
        StreamingResponse：整文件或部分内容
    """
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    # ---- 无 Range 头：返回整个文件 ----
    if not range_header:
        return StreamingResponse(
            iter_file_range(file_path, 0, file_size - 1),
            media_type=content_type,
            headers={
                # 告诉浏览器"本资源支持 Range 请求"
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )

    # ---- 有 Range 头：返回部分内容 ----
    start, end = parse_range_header(range_header, file_size)
    content_length = end - start + 1

    return StreamingResponse(
        iter_file_range(file_path, start, end),
        status_code=206,                # 206 Partial Content
        media_type=content_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(content_length),
        },
    )