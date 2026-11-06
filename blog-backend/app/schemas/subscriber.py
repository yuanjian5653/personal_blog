"""订阅相关的请求 / 响应模型"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SubscribeRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    # 来源标记（前端传 subscribe-page），只用于统计
    source: str | None = Field(default=None, max_length=40)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        # 统一小写并去空格：邮箱的本地部分理论上区分大小写，
        # 但实际上没有邮件服务商这么干，统一小写能避免同一个人重复订阅。
        e = v.strip().lower()
        # 内部空格也算非法：`a b@example.com` 能通过"含 @ 且域名有点"的粗检，
        # 但它永远投递不到，只会在库里留废记录。
        if any(ch.isspace() for ch in e):
            raise ValueError("邮箱不能包含空格")
        if "@" not in e:
            raise ValueError("邮箱格式不正确")
        local, _, domain = e.partition("@")
        if not local or not domain or "." not in domain:
            raise ValueError("邮箱格式不正确")
        return e


class SubscriberRead(BaseModel):
    """后台列表用。**不返回 token**，避免泄漏确认/退订权限。

    必须开 from_attributes：后台是用
    `SubscriberRead.model_validate(sqlmodel对象)` 手动转换的，
    pydantic v2 默认只接受 dict，不开这个会报
    "Input should be a valid dictionary or instance of SubscriberRead"。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    status: str
    source: str | None
    created_at: datetime
    confirmed_at: datetime | None
    unsubscribed_at: datetime | None


class SubscriberStats(BaseModel):
    total: int
    confirmed: int
    pending: int
    unsubscribed: int
