"""
操作日志路由
"""
from fastapi import APIRouter, Depends
from sqlmodel import Session, func, select

from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, OperationLog

router = APIRouter(prefix="/api/logs", tags=["操作日志"])


@router.get("")
def list_logs(
    limit: int = 100,
    offset: int = 0,
    action: str | None = None,
    target_type: str | None = None,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """操作日志列表（分页 + 筛选）"""
    stmt = select(OperationLog)
    if action:
        stmt = stmt.where(OperationLog.action == action)
    if target_type:
        stmt = stmt.where(OperationLog.target_type == target_type)
    stmt = (
        stmt.order_by(OperationLog.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    logs = db.exec(stmt).all()

    # 补上用户名
    result = []
    for log in logs:
        admin = db.get(Admin, log.admin_id)
        result.append(
            {
                "id": log.id,
                "admin_id": log.admin_id,
                "admin_username": admin.username if admin else "(已删除)",
                "action": log.action,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "changes": log.changes,
                "created_at": log.created_at.isoformat()
                if log.created_at
                else None,
            }
        )
    return result


@router.get("/count")
def count_logs(
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """日志总数"""
    total = db.exec(select(func.count(OperationLog.id))).one()
    return {"total": total}


@router.delete("")
def clear_logs(
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    """清空日志（谨慎使用）"""
    for log in db.exec(select(OperationLog)).all():
        db.delete(log)
    db.commit()
    return {"message": "已清空"}