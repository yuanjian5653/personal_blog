"""
邮件订阅者（用于站点更新通知）

设计要点：

1. **双确认（double opt-in）**
   提交邮箱后先落库为 `pending`，用户点确认链接才变 `confirmed`。
   没有这一步，任何人都能用你的域名给任意邮箱发信 —— 域名会很快被拉黑，
   而且在国内属于违规发送商业邮件。

2. **两个独立 token**
   `confirm_token` 和 `unsubscribe_token` 分开，不复用：
   确认链接可能被转发/泄漏（比如用户截图），退订 token 必须保持独立，
   否则拿到确认链接的人也能帮别人退订。

3. **只存必要字段**
   邮箱 + 状态 + token + 来源 + IP 的哈希（不存明文 IP），
   满足"最小必要"原则；后台可删除。

4. **IP 冷却靠 DB 查最近记录实现**
   不引入 Redis（这台服务器只有 1.6G 内存），
   也不用进程内字典（重启就清空，多 worker 也不共享）。
   查一次带索引的最近记录，成本可以忽略。
"""
from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow

# 合法的订阅状态
SUBSCRIBER_STATUSES = ("pending", "confirmed", "unsubscribed")


class Subscriber(SQLModel, table=True):
    """一个订阅者"""

    __tablename__ = "subscribers"

    id: int | None = Field(default=None, primary_key=True)

    # 统一小写存储，避免 Foo@x.com 和 foo@x.com 被当成两个人
    email: str = Field(max_length=254, unique=True, index=True)

    # pending / confirmed / unsubscribed
    status: str = Field(default="pending", max_length=20, index=True)

    # 确认与退订用两个独立 token（secrets.token_urlsafe(32) 生成）
    confirm_token: str = Field(max_length=64, unique=True, index=True)
    unsubscribe_token: str = Field(max_length=64, unique=True, index=True)

    # 从哪来的：footer / subscribe-page / admin
    source: str | None = Field(default=None, max_length=40)

    # 防滥用：只存 IP 的哈希，不存明文
    ip_hash: str | None = Field(default=None, max_length=64, index=True)

    created_at: datetime = Field(default_factory=utcnow, index=True)
    confirmed_at: datetime | None = Field(default=None)
    unsubscribed_at: datetime | None = Field(default=None)
    # 上次发确认信的时间，用于"5 分钟内不重复发"
    last_notified_at: datetime | None = Field(default=None)

