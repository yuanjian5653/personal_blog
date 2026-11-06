"""通知队列相关的请求/响应模型"""
from pydantic import BaseModel, Field


class SiteUpdateBroadcastRequest(BaseModel):
    """手动发一条「网站更新」公告给所有订阅者"""

    title: str = Field(..., min_length=1, max_length=300)
    summary: str | None = Field(default=None, max_length=500)
    # 点开跳哪（站内路径或外链），默认首页
    path: str = Field(default="/", max_length=500)
    # True = 无视冷却、立刻进队列（公告通常就是要现在发）
    immediate: bool = True


class BroadcastResult(BaseModel):
    ok: bool
    message: str
    notification_id: int | None = None
