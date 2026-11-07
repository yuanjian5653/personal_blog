"""
暗号彩蛋（后台可管理）

设计要点：

1. **暗号本身是秘密，所以公开接口不返回它**
   前台不能拉"所有暗号列表"（那样彩蛋就不叫彩蛋了），
   只有一个 `POST /api/easter-eggs/check` 用来校验用户输入的暗号。
   后台接口才返回完整数据（含 code）。

2. **两种 kind**
   background  动态背景 —— 用后台上传的壁纸；没上传时不显示任何东西
   game        小游戏（目前只有「接星星」）

3. **过渡动效存在后台**
   transition 决定"启用瞬间"用哪种切换动画（fade/zoom/slide/blur），
   这样换个感觉不用改代码。

4. **素材按原样存，不做转码**
   服务器只有 1.6G 内存，装不下 ffmpeg；而且视频转码很吃 CPU。
   所以直接在**上传时**限制大小，并提示推荐值。
"""
from datetime import datetime

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel

from app.models._base import utcnow

# 彩蛋类型
EGG_KINDS = ("background", "game")

# 启用时的过渡动效
EGG_TRANSITIONS = ("fade", "zoom", "slide", "blur")

# 素材类型（决定前台用 <video> 还是 <img>）
ASSET_KINDS = ("video", "image")


class EasterEgg(SQLModel, table=True):
    """一个暗号彩蛋"""

    __tablename__ = "easter_eggs"

    id: int | None = Field(default=None, primary_key=True)

    # 暗号（用户要输入的那串）。唯一，比较时前端会做归一化。
    code: str = Field(max_length=60, unique=True, index=True)

    # 展示名（解锁提示里显示）
    name: str = Field(max_length=60)

    # 解锁后的提示语
    hint: str | None = Field(default=None, sa_column=Column(Text, nullable=True))

    # background / stars / game
    kind: str = Field(default="background", max_length=20)

    # 动态壁纸的地址（/media/wallpapers/xxx.mp4）。为空时不显示任何背景。
    asset_path: str | None = Field(default=None, max_length=500)
    # video / image
    asset_kind: str | None = Field(default=None, max_length=20)

    # 启用时的过渡动效
    transition: str = Field(default="fade", max_length=20)

    # 关闭后前台校验直接视为"没有这个暗号"
    is_enabled: bool = Field(default=True, index=True)

    sort_order: int = Field(default=0)

    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow)
