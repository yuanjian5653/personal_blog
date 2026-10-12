"""
认证相关的请求/响应 Schema
这些类不映射数据库表，只用于 API 参数校验和响应序列化
"""
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """登录接口的请求体"""
    username: str = Field(..., min_length=1, max_length=50, description="管理员用户名")
    password: str = Field(..., min_length=1, max_length=128, description="明文密码")


class AdminInfo(BaseModel):
    """返回给前端的管理员信息（绝不包含密码哈希）"""
    id: int
    username: str


class LoginResponse(BaseModel):
    """登录成功后的响应体"""
    message: str = "登录成功"
    admin: AdminInfo