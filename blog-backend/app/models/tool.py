"""
工具（用于 /tools 页面）

设计要点：

1. **一张表容纳所有"工具条目"**
   kind 描述的是"点下去会发生什么"，不是业务实体：
     link  外链      —— 新窗口打开外部网站
     page  站内页面  —— 跳转到本站已有的页面
     app   可下载    —— 下载一个文件（exe / 压缩包等）
   以后若要支持"在网页里直接运行的工具"，再加一个 builtin 值即可，
   不需要动表结构。

2. **slug 是 URL 标识，也是未来的代码挂接点**
   现在（没有详情页）它只用于让条目有稳定可读的标识；
   以后做详情页或站内工具时，就用它与代码里的注册表对应。

3. **click_count 是真的计数**
   友链表里的 record_click 目前只校验存在、不累加（那里注释写了
   "避免假装记了其实没记"）。工具这里用原子 UPDATE 真累加，
   后台能看到使用热度。

4. **暂时没有 description / cover 字段**
   当前版本不做详情页、只用 lucide 图标，所以不预留用不到的字段。
   以后要加：create_all 不会给已存在的表加列，需要写一次性脚本
   （见 blog-backend/scripts/migrate_comments_target.py 的先例）。
"""
from datetime import datetime

from sqlmodel import SQLModel, Field

from app.models._base import utcnow

# 允许的 kind 取值（schema 与 router 都会用到，集中在这里）
TOOL_KINDS = ("link", "page", "app")

# 默认分类
DEFAULT_CATEGORY = "其他"


class Tool(SQLModel, table=True):
    """一个工具条目"""

    __tablename__ = "tools"

    id: int | None = Field(default=None, primary_key=True)

    # URL 标识：小写字母/数字/连字符，唯一
    slug: str = Field(max_length=80, unique=True, index=True)

    name: str = Field(max_length=80)
    # 卡片/列表上的一句话说明
    summary: str | None = Field(default=None, max_length=200)

    # 分组用；不建分类表（工具就几十个，分类 3~6 个，join 不值得）
    category: str = Field(default=DEFAULT_CATEGORY, max_length=40, index=True)

    # link / page / app
    kind: str = Field(default="link", max_length=16)

    # lucide 图标名，如 "Wrench"；前端用静态注册表解析，找不到就回退
    icon: str | None = Field(default=None, max_length=40)

    # 目标地址：link=外部 URL，page=站内路径（/ 开头），app=文件地址
    href: str = Field(max_length=500)

    # 逗号分隔的标签
    tags: str | None = Field(default=None, max_length=200)

    # 排序：值小的在前
    sort_order: int = Field(default=0)

    # 上下架
    is_visible: bool = Field(default=True, index=True)

    # 点击次数（后台可见）
    click_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @property
    def tag_list(self) -> list[str]:
        """标签拆成列表（前端也能自己拆，这里给后端/测试用）"""
        if not self.tags:
            return []
        return [t.strip() for t in self.tags.split(",") if t.strip()]
