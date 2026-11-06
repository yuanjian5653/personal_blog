"""
待发通知（outbox 模式）

为什么用 outbox 而不是"发布时直接发信"：
    发布文章的请求不能等几十封邮件发完才返回。把它写成一行记录是毫秒级的，
    真正的发送交给后台 worker 慢慢做。

两个关键字段设计：

1. **UNIQUE(event_type, target_type, target_id)**
   同一篇内容无论发布接口被调几次、worker 重试几次，都只会产生一条记录
   —— 这是"不会给订阅者重复发同一篇"的根本保证。

2. **scheduled_at**
   冷却合并的实现方式：入队时算好"最早可以发的时间"。
   如果距上次发送还不到冷却期，就顺延到 `上次发送 + 冷却期`。
   于是同一窗口内的多条内容会一起到期，worker 把它们**合并成一封**发出去，
   避免一天发好几封。
"""
from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models._base import utcnow

# 事件类型（也用于邮件标题措辞）
NOTIFY_EVENTS = ("article.new", "essay.new", "life.new")

# 状态
NOTIFY_STATUSES = ("pending", "sending", "sent", "failed")


class NotificationOutbox(SQLModel, table=True):
    """一条待发/已发的通知"""

    __tablename__ = "notification_outbox"
    __table_args__ = (
        UniqueConstraint(
            "event_type",
            "target_type",
            "target_id",
            name="uq_notification_event_target",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    # article.new / essay.new / life.new
    event_type: str = Field(max_length=30, index=True)
    # article / essay / life
    target_type: str = Field(max_length=20)
    target_id: int = Field(index=True)

    # 邮件内容素材（入队时就固定下来，避免 worker 再去查内容表）
    title: str = Field(max_length=300)
    summary: str | None = Field(default=None, max_length=500)
    url: str = Field(max_length=500)

    # pending / sending / sent / failed
    status: str = Field(default="pending", max_length=20, index=True)
    scheduled_at: datetime = Field(default_factory=utcnow, index=True)

    attempts: int = Field(default=0)
    last_error: str | None = Field(default=None, max_length=500)
    # 实际发给了多少个订阅者（0 表示当时没有订阅者）
    sent_count: int = Field(default=0)
    sent_at: datetime | None = Field(default=None)

    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow, index=True)
