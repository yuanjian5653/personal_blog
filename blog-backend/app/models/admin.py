from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow


class Admin(SQLModel, table=True):
    __tablename__ = "admin"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True, max_length=50)
    password_hash: str = Field(max_length=255)

    # ---- 登录失败锁定（防暴力破解）----
    # 连续失败计数达阈值后 locked_until 会被设成未来时间，期间登录一律拒绝。
    # 这两个字段是"账号级"防线；IP 级的滑动窗口在 routers/auth.py 里。
    failed_attempts: int = Field(default=0)
    locked_until: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
