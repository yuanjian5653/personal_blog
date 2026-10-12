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
