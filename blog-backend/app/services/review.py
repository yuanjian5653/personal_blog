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

审核策略是**每个成员自己的**属性（admin.need_review），没有站点级开关：
  · 管理员        → 永不审核（自审自己没意义）
  · 成员的 need_review=False → 免审（信任成员）
  · 成员未设置 / True       → 必须审核（默认，保守安全）
"""
from __future__ import annotations

import logging

from sqlmodel import Session

from app.models import Admin
from app.models.review import (
    REVIEW_APPROVED,
    REVIEW_PENDING,
    REVIEW_REJECTED,
    REVIEW_PASSED,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
)

logger = logging.getLogger(__name__)


# ============================================================
# 新建内容时打状态
# ============================================================

def should_review(db: Session, admin: Admin) -> bool:
    """这个账号发布的内容要不要审核。

    · 管理员 → 永不审核（自审自己没意义）
    · 成员   → 由 need_review 决定：
        显式 False → 免审
        True 或 None（还没设置过）→ 必须审核（默认保守安全）
    """
    if getattr(admin, "role", "admin") == "admin":
        return False
    return getattr(admin, "need_review", None) is not False


def stamp_new_content(obj, admin: Admin, db: Session) -> None:
    """给刚创建的内容打上 status / review_status。

    规则：
      · 管理员 / 免审成员 → approved + published
      · 需审核的成员     → pending + draft

    注意「draft」这一半很关键：
        光设 review_status=pending 不够 —— 如果 status 还是 published，
        任何只过滤 status 的老代码路径依然会把它查出来。
        两条轴同时压住，才不会漏。
    """
    if should_review(db, admin):
        obj.review_status = REVIEW_PENDING
        obj.status = STATUS_DRAFT
    else:
        obj.review_status = REVIEW_APPROVED
        if not getattr(obj, "status", None):
            obj.status = STATUS_PUBLISHED


# ============================================================
# 编辑已通过的内容 → 重新提交审核
# ============================================================

def resubmit_on_edit(obj, admin: Admin, db: Session) -> bool:
    """成员编辑"已通过"的内容时，把它重新压回待审。

    审核通过代表那一版内容没问题。成员改完之后内容已经变了，
    如果还挂着旧通过的标记，等于审核形同虚设。

    管理员编辑不走这条（自审自己没意义），返回 False 表示没动状态。
    """
    if getattr(admin, "role", "admin") == "admin":
        return False
    if getattr(obj, "review_status", REVIEW_APPROVED) != REVIEW_APPROVED:
        return False
    obj.review_status = REVIEW_PENDING
    obj.status = STATUS_DRAFT
    return True


# ============================================================
# 审核决定
# ============================================================

def apply_decision(obj, decision: str) -> None:
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
