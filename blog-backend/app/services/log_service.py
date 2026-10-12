"""
操作日志服务
统一封装日志写入逻辑，所有增删改操作都调用这个函数，
保证日志格式一致、字段完整。
"""
import json
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session

from app.models import OperationLog


def log_operation(
    db: Session,
    admin_id: int,
    action: str,
    target_type: str,
    target_id: int | None = None,
    changes: dict | None = None,
) -> OperationLog:
    """
    写一条操作日志。

    参数:
        db: 数据库 Session（和调用方共用，保证事务一致性）
        admin_id: 操作人的 ID
        action: 操作类型，建议用 "create" / "update" / "delete"
        target_type: 操作对象类型，如 "song" / "post" / "photo" / "config"
        target_id: 操作对象的 ID（新建时可传 None，插入后再补）
        changes: 变更内容，格式 {"字段名": {"old": 旧值, "new": 新值}}
                 新建/删除时可传 None

    返回:
        创建好的 OperationLog 对象（已加入 Session 但未 commit）

    注意:
        这里只 db.add() 不 commit，由调用方决定何时提交。
        这样可以把"业务操作"和"日志写入"放进同一个事务，
        避免业务成功了日志没写、或者日志写了业务回滚的不一致情况。
    """
    log = OperationLog(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        changes=changes,
        created_at=datetime.now(timezone.utc),
    )
    db.add(log)
    # 注意：不 commit，由调用方统一 commit
    return log


def apply_updates(
    db: Session,
    obj: Any,
    new_data: dict,
    admin_id: int,
    target_type: str,
    target_id: int,
    *,
    max_value_len: int | None = None,
) -> dict:
    """
    把 new_data 里真正变化的字段写到 obj 上，并记一条 update 日志。

    这段"逐字段比对 → setattr → 记日志"以前在 album / playlist / article
    四个路由里各写了一遍，现在只留这里一份。

    参数:
        db: 数据库 Session
        obj: 要更新的 ORM 对象
        new_data: 前端提交的字段（建议先做 model_dump(exclude_unset=True)）
        admin_id: 操作人 ID
        target_type: 日志里的对象类型，如 "article"
        target_id: 对象 ID
        max_value_len: 日志里新旧值截断长度；None 表示不截断
                       （文章正文很长，需要截断避免日志爆炸）

    返回:
        {"字段名": {"old": 旧值, "new": 新值}}，只含真正变化的字段。
        调用方据此决定是否还有别的后处理（例如重算字数），
        以及自己 commit。
    """
    changes: dict = {}

    for field, new_value in new_data.items():
        old_value = getattr(obj, field, None)
        if old_value == new_value:
            continue

        if max_value_len is None:
            changes[field] = {"old": old_value, "new": new_value}
        else:
            changes[field] = {
                "old": str(old_value)[:max_value_len],
                "new": str(new_value)[:max_value_len],
            }
        setattr(obj, field, new_value)

    if changes:
        log_operation(db, admin_id, "update", target_type, target_id, changes)

    db.add(obj)
    return changes


# ============================================================
# JSON 数组字段（Essay.images / LifePost.images）
# ============================================================

def loads_json_list(raw: str | None) -> list[str]:
    """
    把数据库里的 JSON 字符串解析成字符串列表。
    内容损坏或不是数组时返回空列表，不让脏数据把接口打成 500。
    """
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data if x]


def dumps_json_list(items: list[str] | None) -> str:
    """把字符串列表存成 JSON 字符串（保留中文，不转义成 \\uXXXX）。"""
    return json.dumps(items or [], ensure_ascii=False)
