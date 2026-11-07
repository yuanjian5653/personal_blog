"""暗号彩蛋的请求 / 响应模型

注意 `EasterEggPublic` **故意不含 code**：
前台永远拿不到暗号列表，只能拿"某个暗号对不对"的结果。
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

EggKind = Literal["background", "stars", "game"]
EggTransition = Literal["fade", "zoom", "slide", "blur"]
AssetKind = Literal["video", "image"]


# ---------------- 后台 ----------------

class EasterEggBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=60)
    name: str = Field(..., min_length=1, max_length=60)
    hint: str | None = None
    kind: EggKind = "background"
    asset_path: str | None = Field(default=None, max_length=500)
    asset_kind: AssetKind | None = None
    transition: EggTransition = "fade"
    is_enabled: bool = True
    sort_order: int = 0


class EasterEggCreate(EasterEggBase):
    pass


class EasterEggUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=60)
    name: str | None = Field(default=None, min_length=1, max_length=60)
    hint: str | None = None
    kind: EggKind | None = None
    asset_path: str | None = Field(default=None, max_length=500)
    asset_kind: AssetKind | None = None
    transition: EggTransition | None = None
    is_enabled: bool | None = None
    sort_order: int | None = None


class EasterEggRead(EasterEggBase):
    """后台列表项（含暗号）"""

    id: int
    created_at: datetime
    updated_at: datetime


# ---------------- 前台 ----------------

class EggCheckRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=60)


class EggCheckResult(BaseModel):
    """校验通过后返回的"够用就好"信息（不含暗号）"""

    egg_id: int
    name: str
    hint: str | None
    kind: str
    asset_path: str | None
    asset_kind: str | None
    transition: str
