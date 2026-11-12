"""
模型公共部分。

所有表都有一堆"创建时间 / 更新时间"字段，之前每个模型文件都写了一遍
`default_factory=lambda: datetime.now(timezone.utc)`，统一收在这里。
"""
from datetime import datetime, timezone


def utcnow() -> datetime:
    """当前 UTC 时间（带时区），用作字段默认值。

    用法：`created_at: datetime = Field(default_factory=utcnow)`
    """
    return datetime.now(timezone.utc)


def as_aware(dt: datetime | None) -> datetime | None:
    """把 MySQL 取出来的 naive DATETIME 补上 UTC。

    MySQL 的 DATETIME 不存时区，读出来是 naive；直接和
    datetime.now(timezone.utc) 比较会抛 TypeError。统一走这里。

    这个函数原来在 admin.py / auth.py / comments.py 各有一份，
    其中两处不接受 None、一处接受 —— 现在统一成接受 None。
    """
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
