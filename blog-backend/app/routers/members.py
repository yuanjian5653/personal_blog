"""
成员管理（仅管理员）

  GET    /api/admin/members              列表（含内容数量）
  POST   /api/admin/members              创建成员（返回初始密码，只此一次）
  PUT    /api/admin/members/{id}         改显示名 / 角色 / 状态 / 上传配额
  POST   /api/admin/members/{id}/password  重置密码
  DELETE /api/admin/members/{id}         删除（同时删掉 ta 的所有内容？不 —— 见下）

---- 三条保护规则（都写成代码，不靠人记）----

1. **必须保留至少一个启用状态的管理员**
   降级、停用、删除最后一个管理员 → 409 拒绝。
   否则没人能再进后台，等于把站点锁死。

2. **不能改自己的角色/状态**
   防止管理员误操作把自己降成成员或停用，当场失去权限。

3. **改角色 / 停用 / 重置密码 → 立刻删掉该账号所有 session**
   否则对方手里的旧 Cookie 还能继续用，改了个寂寞。

---- 为什么删除成员时不删 ta 的内容 ----
内容可能是站点的一部分（文章有外链、评论挂在上面）。
删账号但保留内容，作者归到"已注销"更安全；要清理内容请单独删。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, func, select

from app.database import get_session
from app.deps import require_admin_role
from app.db_utils import count as db_count
from app.models import (
    Admin,
    AdminSession,
    Album,
    Article,
    Essay,
    FriendLink,
    LifePost,
    Photo,
)
from app.models.admin import (
    ROLE_ADMIN,
    ROLE_MEMBER,
    ROLES,
    STATUS_ACTIVE,
    STATUSES,
)
from app.schemas.member import (
    MemberCreate,
    MemberCreated,
    MemberRead,
    MemberUpdate,
    PasswordReset,
)
from app.services.security import hash_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/members", tags=["成员管理"])

# 内容表（用于统计某人的发布数量）
CONTENT_MODELS = (Article, Essay, LifePost, Album, Photo, FriendLink)


def _content_count(db: Session, admin_id: int) -> int:
    total = 0
    for model in CONTENT_MODELS:
        total += db_count(
            db.exec(
                select(func.count())
                .select_from(model)
                .where(model.author_id == admin_id)
            ).one()
        )
    return total


def _to_read(db: Session, admin: Admin, viewer: Admin) -> MemberRead:
    return MemberRead(
        id=int(admin.id or 0),
        username=admin.username,
        display_name=admin.display_name,
        role=admin.role if admin.role in ROLES else ROLE_MEMBER,
        status=admin.status if admin.status in STATUSES else STATUS_ACTIVE,
        upload_quota=admin.upload_quota,
        last_login_at=admin.last_login_at,
        created_at=admin.created_at,
        content_count=_content_count(db, int(admin.id or 0)),
        # 自己那行不给"改角色/停用/删除"（前端置灰用）
        editable=int(admin.id or 0) != int(viewer.id or 0),
    )


def _active_admin_count(db: Session, exclude_id: int | None = None) -> int:
    """当前有几个"启用中的管理员"。"""
    rows = db.exec(
        select(Admin).where(Admin.role == ROLE_ADMIN, Admin.status == STATUS_ACTIVE)
    ).all()
    admins = [r if isinstance(r, Admin) else r[0] for r in rows]
    return sum(
        1
        for a in admins
        if isinstance(a, Admin) and (exclude_id is None or a.id != exclude_id)
    )


def _drop_sessions(db: Session, admin_id: int) -> int:
    """删掉某账号的所有 session，返回删了几条。"""
    rows = db.exec(
        select(AdminSession).where(AdminSession.admin_id == admin_id)
    ).all()
    n = 0
    for r in rows:
        obj = r if isinstance(r, AdminSession) else r[0]
        if isinstance(obj, AdminSession):
            db.delete(obj)
            n += 1
    return n


# ============================================================
# 列表
# ============================================================

@router.get("", response_model=list[MemberRead])
def list_members(
    db: Session = Depends(get_session),
    me: Admin = Depends(require_admin_role),
):
    """所有后台账号，管理员在前、成员在后，同角色按创建时间。"""
    rows = db.exec(select(Admin).order_by(Admin.id)).all()
    admins = [r if isinstance(r, Admin) else r[0] for r in rows]
    admins = [a for a in admins if isinstance(a, Admin)]

    admins.sort(key=lambda a: (0 if a.role == ROLE_ADMIN else 1, a.created_at))
    return [_to_read(db, a, me) for a in admins]


# ============================================================
# 创建
# ============================================================

@router.post("", response_model=MemberCreated, status_code=status.HTTP_201_CREATED)
def create_member(
    payload: MemberCreate,
    db: Session = Depends(get_session),
    me: Admin = Depends(require_admin_role),
):
    """创建后台账号（成员或另一个管理员）。"""
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="登录名不能为空")

    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail=f"不支持的角色：{payload.role}")

    existed = db.exec(select(Admin).where(Admin.username == username)).first()
    if existed is not None:
        raise HTTPException(status_code=409, detail="这个登录名已经被占用了")

    password = payload.password
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="密码至少 12 位")

    admin = Admin(
        username=username,
        password_hash=hash_password(password),
        role=payload.role,
        status=STATUS_ACTIVE,
        display_name=(payload.display_name or "").strip() or username,
        upload_quota=payload.upload_quota,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    logger.info(
        "[成员] %s 创建了 %s（role=%s）", me.username, username, payload.role
    )

    return MemberCreated(
        member=_to_read(db, admin, me),
        # 只在这个响应里回一次；之后数据库里只有 bcrypt 哈希，谁也拿不到明文
        password=password,
    )


# ============================================================
# 修改
# ============================================================

@router.put("/{member_id}", response_model=MemberRead)
def update_member(
    member_id: int,
    payload: MemberUpdate,
    db: Session = Depends(get_session),
    me: Admin = Depends(require_admin_role),
):
    """改显示名 / 角色 / 状态 / 上传配额。"""
    target = db.get(Admin, member_id)
    if target is None:
        raise HTTPException(status_code=404, detail="账号不存在")

    data = payload.model_dump(exclude_unset=True)

    # ---- 规则 2：不能改自己 ----
    if int(target.id or 0) == int(me.id or 0):
        if "role" in data or "status" in data:
            raise HTTPException(
                status_code=400,
                detail="不能修改自己的角色或状态（避免把自己锁在门外）",
            )

    # ---- 规则 1：不能动掉最后一个管理员 ----
    demoting = data.get("role") is not None and data["role"] != ROLE_ADMIN
    disabling = data.get("status") is not None and data["status"] != STATUS_ACTIVE
    target_is_admin = target.role == ROLE_ADMIN and target.status == STATUS_ACTIVE

    if target_is_admin and (demoting or disabling):
        if _active_admin_count(db, exclude_id=member_id) == 0:
            raise HTTPException(
                status_code=409,
                detail="这是最后一个启用中的管理员，不能降级或停用",
            )

    # ---- 规则：成员不能被提升为管理员 ----
    # 管理员账号只能在创建时明确指定（创建是"有意为之"的动作），
    # 不允许事后把已有成员提权 —— 提权是越权最常见的一条路。
    if (
        data.get("role") == ROLE_ADMIN
        and target.role != ROLE_ADMIN
    ):
        raise HTTPException(
            status_code=400,
            detail="不能把成员提升为管理员（如需管理员请新建账号并直接指定角色）",
        )

    # ---- 登录名唯一性 ----
    if "username" in data:
        new_name = (data["username"] or "").strip()
        if len(new_name) < 2:
            raise HTTPException(status_code=400, detail="登录名至少 2 个字符")
        clash = db.exec(
            select(Admin).where(Admin.username == new_name, Admin.id != member_id)
        ).first()
        if clash is not None:
            raise HTTPException(status_code=409, detail="这个登录名已被占用")
        data["username"] = new_name

    if "role" in data and data["role"] not in ROLES:
        raise HTTPException(status_code=400, detail=f"不支持的角色：{data['role']}")
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=400, detail=f"不支持的状态：{data['status']}")

    old_role, old_status = target.role, target.status

    for key, value in data.items():
        if key == "display_name":
            setattr(target, key, (value or "").strip() or target.username)
        else:
            setattr(target, key, value)

    # ---- 规则 3：角色或状态变了，立刻踢下线 ----
    kicked = 0
    if (
        ("role" in data and data["role"] != old_role)
        or ("status" in data and data["status"] != old_status)
    ):
        kicked = _drop_sessions(db, member_id)

    db.add(target)
    db.commit()
    db.refresh(target)

    if kicked:
        logger.info("[成员] %s 被强制下线（%d 条会话）", target.username, kicked)
    logger.info("[成员] %s 修改了 %s", me.username, target.username)

    return _to_read(db, target, me)


@router.post("/{member_id}/password")
def reset_password(
    member_id: int,
    payload: PasswordReset,
    db: Session = Depends(get_session),
    me: Admin = Depends(require_admin_role),
):
    """重置某个账号的密码，并踢掉它的所有会话。"""
    target = db.get(Admin, member_id)
    if target is None:
        raise HTTPException(status_code=404, detail="账号不存在")

    if len(payload.new_password) < 12:
        raise HTTPException(status_code=400, detail="密码至少 12 位")

    target.password_hash = hash_password(payload.new_password)
    # 重置密码顺带解锁，否则刚改完还是登不上
    target.failed_attempts = 0
    target.locked_until = None
    db.add(target)
    kicked = _drop_sessions(db, member_id)
    db.commit()

    logger.info(
        "[成员] %s 重置了 %s 的密码（踢下线 %d 条会话）",
        me.username,
        target.username,
        kicked,
    )
    return {"message": "密码已重置，该账号需要重新登录"}


# ============================================================
# 删除
# ============================================================

@router.delete("/{member_id}")
def delete_member(
    member_id: int,
    db: Session = Depends(get_session),
    me: Admin = Depends(require_admin_role),
):
    """停用账号（软删除）。

    为什么**不做物理删除**（这是测试跑出来的结论，不是保守）：
      1. operation_logs.admin_id 外键指向 admin —— 有操作日志的账号一删
         数据库直接报 1451，接口 500。
      2. 内容表的 author_id 也指向 admin —— 删了会让作者归属断链。
      3. 更重要的：审计日志必须能追溯"是谁做的"。物理删除账号等于
         把证据一起删掉，正好和刚做完的安全加固反过来。

    所以统一做软删除：status=disabled + 清掉该账号所有会话。
    登录名会一直被占用；要复用同一个名字，请先把旧账号改名。
    ta 发布的内容保留（文章可能有外链、评论挂在上面）。
    """
    target = db.get(Admin, member_id)
    if target is None:
        raise HTTPException(status_code=404, detail="账号不存在")

    if int(target.id or 0) == int(me.id or 0):
        raise HTTPException(status_code=400, detail="不能删除自己")

    if target.role == ROLE_ADMIN and target.status == STATUS_ACTIVE:
        if _active_admin_count(db, exclude_id=member_id) == 0:
            raise HTTPException(
                status_code=409, detail="这是最后一个启用中的管理员，不能删除"
            )

    target.status = "disabled"
    db.add(target)
    kicked = _drop_sessions(db, member_id)
    db.commit()

    logger.info(
        "[成员] %s 停用了账号 %s（踢下线 %d 条会话）",
        me.username,
        target.username,
        kicked,
    )
    return {
        "message": "已停用（账号记录与操作日志保留，内容不删）",
        "username": target.username,
    }
