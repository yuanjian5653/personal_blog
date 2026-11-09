"""成员管理 schema。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["admin", "member"]
Status = Literal["active", "pending", "disabled"]


class MemberRead(BaseModel):
    """后台成员列表项。**不含 password_hash**。"""

    id: int
    username: str
    display_name: str | None
    role: Role
    status: Status
    upload_quota: int | None
    last_login_at: datetime | None
    created_at: datetime
    # 该账号发布的内容数量（列表页显示用）
    content_count: int = 0
    # 当前登录者能不能改这条（前端据此置灰按钮）
    editable: bool = True


class MemberCreate(BaseModel):
    """管理员创建成员。

    管理员账号也走这个接口，只是 role 传 admin。
    初始密码由管理员指定，成员首次登录后应自行修改。
    """

    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=12, max_length=128)
    display_name: str | None = Field(default=None, max_length=60)
    role: Role = "member"
    upload_quota: int | None = Field(default=None, ge=0, le=100000)


class MemberUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=60)
    role: Role | None = None
    status: Status | None = None
    upload_quota: int | None = Field(default=None, ge=0, le=100000)


class PasswordReset(BaseModel):
    new_password: str = Field(..., min_length=12, max_length=128)


class MemberCreated(BaseModel):
    """创建结果。把密码回给管理员一次，之后再也拿不到。"""

    member: MemberRead
    password: str
