"""
内容审核（阶段 2-B 的核心逻辑，集中在这一处）

为什么必须集中：
    给 essays / life_posts / photos / friend_links 加 status + review_status 之后，
    **每一个公开查询都要加过滤条件**。散在各个路由里写，漏一处就等于
    "待审内容被公开看到" —— 这种漏洞不会报错，只会静静地把不该露的内容露出去。

    所以这里只提供两个入口：
      · public_conditions(model)  所有公开查询必须拼它
      · stamp_new_content(...)    所有新建内容必须过它

    路由里不允许自己写 status / review_status 的判断。
"""
from __future__ import annotations

import logging

from sqlmodel import Session, select

from app.models import Admin, SiteConfig
from app.models.review import (
    REVIEW_APPROVED,
    REVIEW_PENDING,
    REVIEW_REJECTED,
    REVIEW_PASSED,
    SETTING_REVIEW_REQUIRED,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
)

logger = logging.getLogger(__name__)

# 默认需要审核（你在需求里选的"2B：默认审核，可以设置直接公开"）
DEFAULT_REVIEW_REQUIRED = True


# ============================================================
# 站点开关
# ============================================================

def review_required(db: Session) -> bool:
    """成员新提交的内容是否需要审核。

    读 site_config 的 member_review_required；没配过就按默认（需要审核）。
    管理员的内容永远不需要审核 —— 那是自审自己。
    """
    row = db.exec(
        select(SiteConfig).where(SiteConfig.config_key == SETTING_REVIEW_REQUIRED)
    ).first()
    cfg = row if isinstance(row, SiteConfig) else (row[0] if row else None)
    if cfg is None or not cfg.config_value:
        return DEFAULT_REVIEW_REQUIRED
    return cfg.config_value.strip().lower() in ("1", "true", "yes", "on")


def set_review_required(db: Session, required: bool) -> bool:
    """写入开关，返回写入后的值。"""
    row = db.exec(
        select(SiteConfig).where(SiteConfig.config_key == SETTING_REVIEW_REQUIRED)
    ).first()
    cfg = row if isinstance(row, SiteConfig) else (row[0] if row else None)
    value = "true" if required else "false"
    if cfg is None:
        db.add(SiteConfig(config_key=SETTING_REVIEW_REQUIRED, config_value=value))
    else:
        cfg.config_value = value
        db.add(cfg)
    db.commit()
    return required


# ============================================================
# 新建内容时打状态
# ============================================================

def stamp_new_content(obj, admin: Admin, db: Session) -> None:
    """给刚创建的内容打上 status / review_status。

    规则：
      · 管理员发的       → approved + published（不用审自己的东西）
      · 成员发的         → 需要审核时 pending + draft；关掉开关则 approved + published

    注意「draft」这一半很关键：
        光设 review_status=pending 不够 —— 如果 status 还是 published，
        任何只过滤 status 的老代码路径依然会把它查出来。
        两条轴同时压住，才不会漏。
    """
    is_admin = getattr(admin, "role", "admin") == "admin"

    if is_admin:
        obj.review_status = REVIEW_APPROVED
        if not getattr(obj, "status", None):
            obj.status = STATUS_PUBLISHED
        return

    if review_required(db):
        obj.review_status = REVIEW_PENDING
        obj.status = STATUS_DRAFT
    else:
        obj.review_status = REVIEW_APPROVED
        obj.status = STATUS_PUBLISHED


# ============================================================
# 审核决定
# ============================================================

def apply_decision(obj, decision: str, review_required_now: bool = True) -> None:
    """通过 / 驳回。

    通过 → approved + published
    驳回 → rejected + draft（内容保留但不公开，作者可以改完重新提交）
    """
    if decision == "approve":
        obj.review_status = REVIEW_APPROVED
        obj.status = STATUS_PUBLISHED
    elif decision == "reject":
        obj.review_status = REVIEW_REJECTED
        obj.status = STATUS_DRAFT
    else:
        raise ValueError(f"不支持的审核决定: {decision}")


# ============================================================
# 公开查询条件（唯一入口）
# ============================================================

def public_conditions(model):
    """构造"这条内容对公众可见"的 SQL 条件列表。

    用法（所有公开接口都要这样写）：

        stmt = select(Article).where(*public_conditions(Article))

    含义：已发布 且 审核通过（none/approved）。
    两者缺一不可 —— 只判 status 会漏掉"状态仍是 published 但被驳回"的历史脏数据。
    """
    return [
        model.status == STATUS_PUBLISHED,
        model.review_status.in_(list(REVIEW_PASSED)),
    ]


def is_publicly_visible(obj) -> bool:
    """单条内容是否对公众可见（详情页/通知推送用）。"""
    status = getattr(obj, "status", STATUS_PUBLISHED)
    review = getattr(obj, "review_status", REVIEW_APPROVED)
    return status == STATUS_PUBLISHED and review in REVIEW_PASSED
