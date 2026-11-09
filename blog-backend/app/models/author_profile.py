"""
作者档案（每个后台账号一份）

为什么独立成表而不是往 admin 表加列：
    · 这里十几个字段，其中 about_content 是长文本
    · 登录/鉴权完全用不到这些字段，放一起会让每次查账号都拖着大字段
    · 阶段 3 会用它渲染 /members 和 /members/[slug]

和 site_config 的关系：
    原来"关于页"用的是 site_config 里的全局单例键
    （author_name / author_avatar / author_bio / social_* / about_*）。
    那些键保留下来作为**站点介绍**（/about），
    每个成员的个人页则读这张表。
"""
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._base import utcnow


class AuthorProfile(SQLModel, table=True):
    __tablename__ = "author_profiles"

    # 一个账号一份档案，直接用 admin_id 当主键
    admin_id: int = Field(foreign_key="admin.id", primary_key=True)

    avatar_url: str | None = Field(default=None, max_length=500)
    bio: str | None = Field(default=None, max_length=300)

    social_github: str | None = Field(default=None, max_length=300)
    social_email: str | None = Field(default=None, max_length=200)
    social_telegram: str | None = Field(default=None, max_length=200)
    social_discord: str | None = Field(default=None, max_length=200)

    # 关于页（阶段 3 用）
    about_banner: str | None = Field(default=None, max_length=500)
    about_subtitle: str | None = Field(default=None, max_length=200)
    about_content: str | None = Field(default=None)

    # 是否出现在 /members 列表；默认关（你要求"默认关"）
    is_public: bool = Field(default=False, index=True)

    updated_at: datetime = Field(default_factory=utcnow)
