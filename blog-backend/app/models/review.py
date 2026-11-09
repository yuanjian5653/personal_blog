"""
内容审核状态。

为什么需要独立的一套常量：
    原来只有 articles 有 status（published/draft），其余内容表一直是"发了就公开"。
    现在成员的内容要先审，就需要一个**与"是否公开"正交**的维度：

      status          published | draft      —— 这条内容是否对公众可见
      review_status   none | pending | approved | rejected —— 这条内容是否过审

    两者分开的好处：
      · 成员可以一边写草稿一边等上一条的审核
      · "驳回"是终态，不会因为管理员改 status 而变
      · 历史数据（迁移前）一律 approved，线上表现完全不变
"""
from app.models._base import utcnow  # noqa: F401  （保持与其它 model 模块一致的导入习惯）

REVIEW_NONE = "none"
REVIEW_PENDING = "pending"
REVIEW_APPROVED = "approved"
REVIEW_REJECTED = "rejected"
REVIEW_STATUSES = (REVIEW_NONE, REVIEW_PENDING, REVIEW_APPROVED, REVIEW_REJECTED)

STATUS_PUBLISHED = "published"
STATUS_DRAFT = "draft"

# 需要通过"待审"才算公开的状态集合
REVIEW_PASSED = (REVIEW_NONE, REVIEW_APPROVED)

# 站点设置里控制"成员新内容是否需要审核"的开关键
SETTING_REVIEW_REQUIRED = "member_review_required"
