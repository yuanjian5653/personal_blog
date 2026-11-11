"""
后台账号（管理员 / 成员）

---- 为什么还叫 admin 表 ----
这个表原本只有"一个管理员"。现在要支持多角色，但**表名不改** ——
它被十几处外键、session 表、路由引用，改名要动几十个文件且风险高。
加列即可，语义上它就是"后台账号"。

---- 两个正交的状态维度 ----
role    admin | member      谁能看到哪些菜单、能不能审核
status  active | pending | disabled
        active   能登录、能用
        pending  已创建但未通过审核（阶段 2 的注册流程用；阶段 1 只有 active）
        disabled 被停用，登录一律拒绝

---- 必须保留至少一个管理员 ----
永远要保留至少一个 role=admin 且 status=active 的账号，
否则站点就没人能管了。这条规则写在 routers/members.py 里。
"""
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._base import utcnow

# 角色
ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"
ROLES = (ROLE_ADMIN, ROLE_MEMBER)

# 账号状态
STATUS_ACTIVE = "active"
STATUS_PENDING = "pending"
STATUS_DISABLED = "disabled"
STATUSES = (STATUS_ACTIVE, STATUS_PENDING, STATUS_DISABLED)

# 成员默认每月上传配额（张）。0 = 不限。
DEFAULT_MEMBER_UPLOAD_QUOTA = 30
# 成员默认可上传几首本地音乐（0 = 不限）
DEFAULT_MEMBER_MUSIC_QUOTA = 5


class Admin(SQLModel, table=True):
    """后台账号（管理员或成员）"""

    __tablename__ = "admin"

    id: int | None = Field(default=None, primary_key=True)

    # 登录名（唯一）
    username: str = Field(unique=True, index=True, max_length=50)
    password_hash: str = Field(max_length=255)

    # ---- 多角色 ----
    role: str = Field(default=ROLE_ADMIN, max_length=20, index=True)
    status: str = Field(default=STATUS_ACTIVE, max_length=20, index=True)
    # 对外显示名（作者徽章、成员列表用它，不是登录名）
    display_name: str | None = Field(default=None, max_length=60)

    # ---- 审核策略（按人）----
    # None = 跟随站点全局开关；True = 必须审核；False = 免审
    # 管理员（role=admin）永远免审，这个字段只对成员有意义
    need_review: bool | None = Field(default=None)

    # ---- 音乐 / 项目的成员权限 ----
    # 本地音乐能上传几首（0 = 不限；None = 用默认值）
    music_quota: int | None = Field(default=None)
    # 能不能用网易云相关功能（成员共享站长的网易云账号）
    netease_enabled: bool | None = Field(default=None)
    # 能不能用 GitHub 同步自己的项目（账号由成员自己在项目管理里填）
    github_enabled: bool | None = Field(default=None)
    # 自己的网易云 MUSIC_U Cookie（成员自己在音乐管理里填；
    # 为空则用站点配置里站长的那份）
    netease_cookie: str | None = Field(default=None, max_length=500)
    # 成员自己的 GitHub Token，用来把**他自己的**仓库同步进来。
    # 为空则退回站点级的 settings.GITHUB_TOKEN（那样只能拉到站长的仓库）。
    github_token: str | None = Field(default=None, max_length=255)
    # 配对的 GitHub 用户名（拉哪个账号的仓库）
    github_username: str | None = Field(default=None, max_length=100)

    # ---- 上传配额 ----
    # 每月最多上传多少张图片；None = 用站点默认值，0 = 不限
    upload_quota: int | None = Field(default=None)

    last_login_at: datetime | None = Field(default=None)

    # ---- 登录失败锁定（防暴力破解）----
    # 连续失败计数达阈值后 locked_until 会被设成未来时间，期间登录一律拒绝。
    # 这两个字段是"账号级"防线；IP 级的滑动窗口在 routers/auth.py 里。
    failed_attempts: int = Field(default=0)
    locked_until: datetime | None = Field(default=None)

    created_at: datetime = Field(default_factory=utcnow)

    @property
    def is_admin_role(self) -> bool:
        """是不是管理员（拥有全部权限）"""
        return self.role == ROLE_ADMIN

    @property
    def is_active(self) -> bool:
        return self.status == STATUS_ACTIVE

    @property
    def shown_name(self) -> str:
        """对外展示用的名字：优先 display_name，退回登录名"""
        return (self.display_name or "").strip() or self.username
