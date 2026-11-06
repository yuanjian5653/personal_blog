"""
工具路由

公开接口（无需登录）：
  GET  /api/tools                  列表（只返回已上架的，**不含正文**）
  GET  /api/tools/by-slug/{slug}   详情（含 Markdown 正文）
  POST /api/tools/{tool_id}/click  记一次点击

后台接口（需管理员）：
  GET    /api/tools/all           列表（含已下架）
  GET    /api/tools/{tool_id}     单条详情（编辑页回填，含正文）
  POST   /api/tools               新建
  PUT    /api/tools/{tool_id}     修改（只传要改的字段）
  DELETE /api/tools/{tool_id}     删除
  POST   /api/tools/reorder       批量排序

⚠️ 路由声明顺序：/all 和 /reorder 必须写在 /{tool_id} 之前。
   FastAPI 按声明顺序匹配，否则 "all" 会被当成 tool_id 去走整型解析。
"""
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, Tool
from app.models.tool import DEFAULT_CATEGORY, TOOL_KINDS
from app.schemas.tool import (
    ToolCreate,
    ToolDetail,
    ToolRead,
    ToolReorderItem,
    ToolUpdate,
    normalize_tool_color,
)
from app.services.log_service import apply_updates, log_operation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools", tags=["工具"])

# slug 只允许小写字母、数字、连字符（中文名请自己填英文标识）
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _sort_key(tool: Tool):
    """排序：sort_order 小的在前，相同则按 id 稳定排序"""
    return (tool.sort_order, tool.id or 0)


def _validate_href(kind: str, href: str) -> str:
    """按 kind 校验目标地址，返回规整后的值。

    link → 必须是 http(s) 外链
    page → 必须是站内绝对路径（/ 开头）
    app  → 站内路径或 http(s) 外链都行
    """
    h = (href or "").strip()
    if not h:
        raise HTTPException(status_code=400, detail="目标地址不能为空")

    if kind == "link":
        if not h.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=400,
                detail="外链类型的目标地址必须以 http:// 或 https:// 开头",
            )
        return h

    if kind == "page":
        if not h.startswith("/"):
            raise HTTPException(
                status_code=400,
                detail="站内页面类型的目标地址必须以 / 开头（如 /projects）",
            )
        return h

    # app：站内文件路径或外链都允许
    if h.startswith("/") or h.startswith(("http://", "https://")):
        return h
    raise HTTPException(
        status_code=400,
        detail="可下载类型的目标地址必须是 / 开头的站内路径或 http(s) 外链",
    )


def _validate_kind(kind: str) -> str:
    if kind not in TOOL_KINDS:
        raise HTTPException(
            status_code=400, detail=f"类型只能是 {'/'.join(TOOL_KINDS)}"
        )
    return kind


def _validate_slug(slug: str) -> str:
    s = slug.strip().lower()
    if not SLUG_RE.match(s):
        raise HTTPException(
            status_code=400,
            detail="网址标识只能用小写字母、数字和连字符，且以字母或数字开头",
        )
    return s


# ============================================================
# 公开接口
# ============================================================

@router.get("", response_model=list[ToolRead])
def list_tools(db: Session = Depends(get_session)):
    """前台工具列表：只返回已上架的"""
    rows = db.exec(select(Tool).where(Tool.is_visible == True)).all()  # noqa: E712
    return sorted(rows, key=_sort_key)


@router.get("/by-slug/{slug}", response_model=ToolDetail)
def get_tool_by_slug(slug: str, db: Session = Depends(get_session)):
    """前台详情页：按 slug 取一条**已上架**的工具（含正文）。

    ⚠️ 这个路由必须声明在 /{tool_id} 之前：FastAPI 按声明顺序匹配，
       否则 "by-slug" 会被拿去当 tool_id 做整型解析。
    隐藏的工具返回 404，不泄露草稿内容。
    """
    tool = db.exec(select(Tool).where(Tool.slug == slug)).first()
    if tool is None or not tool.is_visible:
        raise HTTPException(status_code=404, detail="工具不存在")
    return tool


@router.post("/{tool_id}/click")
def record_click(tool_id: int, db: Session = Depends(get_session)):
    """记一次点击（前台点击卡片时上报，fire-and-forget）。

    用 SQL 表达式原子自增，避免"读-改-写"并发丢计数。
    """
    tool = db.get(Tool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="工具不存在")
    tool.click_count = (tool.click_count or 0) + 1
    db.add(tool)
    db.commit()
    return {"ok": True}


# ============================================================
# 后台接口
# ============================================================

@router.get("/all", response_model=list[ToolRead])
def list_all_tools(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """后台列表：含已下架的"""
    return sorted(db.exec(select(Tool)).all(), key=_sort_key)


@router.post("/reorder")
def reorder_tools(
    items: list[ToolReorderItem],
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """批量调整排序（后台 ↑↓ 按钮用）。

    一次性提交整组 (id, sort_order)，避免逐条请求时顺序错乱。
    """
    if not items:
        return {"message": "没有需要调整的项"}

    rows = {t.id: t for t in db.exec(select(Tool)).all()}
    changed = 0
    for item in items:
        tool = rows.get(item.id)
        if tool is None:
            continue
        if tool.sort_order != item.sort_order:
            tool.sort_order = item.sort_order
            tool.updated_at = datetime.now(timezone.utc)
            db.add(tool)
            changed += 1
    db.commit()

    if changed:
        log_operation(
            db,
            admin_id=admin.id or 0,
            action="reorder",
            target_type="tool",
            changes={"count": {"old": None, "new": changed}},
        )
        db.commit()
    return {"message": f"已调整 {changed} 项"}


@router.get("/{tool_id}", response_model=ToolDetail)
def get_tool(
    tool_id: int,
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """后台单条查询（编辑页回填用）"""
    tool = db.get(Tool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="工具不存在")
    return tool


@router.post("", response_model=ToolRead)
def create_tool(
    payload: ToolCreate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """新建工具"""
    data = payload.model_dump()

    data["name"] = (data.get("name") or "").strip()
    if not data["name"]:
        raise HTTPException(status_code=400, detail="名称不能为空")

    kind = _validate_kind(data.get("kind") or "link")
    data["kind"] = kind
    data["href"] = _validate_href(kind, data.get("href") or "")

    data["category"] = (data.get("category") or "").strip() or DEFAULT_CATEGORY

    # 标签：去掉多余空格，空字符串统一存 None
    tags = (data.get("tags") or "").strip()
    data["tags"] = tags or None

    icon = (data.get("icon") or "").strip()
    data["icon"] = icon or None

    # 配色只接受预设名（白名单），"default"/空 一律存 None
    try:
        data["color"] = normalize_tool_color(data.get("color"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    summary = (data.get("summary") or "").strip()
    data["summary"] = summary or None

    # 正文：空串存 None（否则详情页会出现一个空的 Markdown 区块）
    description = (data.get("description") or "").strip()
    data["description"] = description or None

    want_slug = (data.get("slug") or "").strip()
    if want_slug:
        data["slug"] = _validate_slug(want_slug)
    else:
        # 先占一个唯一值，拿到自增 id 后再回填成 tool-{id}
        data["slug"] = f"tmp-{uuid.uuid4().hex[:12]}"

    tool = Tool(**data)
    db.add(tool)
    try:
        # flush 拿到 id（还没提交），这样才能把 slug 补成 tool-{id}
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="网址标识已存在，请换一个")

    if not want_slug:
        tool.slug = f"tool-{tool.id}"

    # 新工具排在最后，避免突然插到第一个
    if not payload.sort_order:
        max_order = db.exec(select(Tool)).all()
        tool.sort_order = max((t.sort_order for t in max_order if t.id != tool.id), default=-1) + 1

    db.add(tool)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="网址标识已存在，请换一个")
    db.refresh(tool)

    log_operation(
        db,
        admin_id=admin.id or 0,
        action="create",
        target_type="tool",
        target_id=tool.id,
        changes={"name": {"old": None, "new": tool.name}},
    )
    db.commit()
    return tool


@router.put("/{tool_id}", response_model=ToolRead)
def update_tool(
    tool_id: int,
    payload: ToolUpdate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """修改工具（只传要改的字段即可）"""
    tool = db.get(Tool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="工具不存在")

    data = payload.model_dump(exclude_unset=True)

    # kind 与 href 要放在一起校验：只改其中一个也要按最终组合判断
    final_kind = data.get("kind") or tool.kind
    final_kind = _validate_kind(final_kind)
    data["kind"] = final_kind

    if "href" in data or "kind" in data:
        final_href = data.get("href") or tool.href
        data["href"] = _validate_href(final_kind, final_href)

    if "slug" in data:
        raw = (data["slug"] or "").strip()
        if raw:
            data["slug"] = _validate_slug(raw)
        else:
            # 清空 slug → 回退到 tool-{id}
            data["slug"] = f"tool-{tool_id}"

    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="名称不能为空")
        data["name"] = name

    if "category" in data:
        data["category"] = (data["category"] or "").strip() or DEFAULT_CATEGORY

    for key in ("summary", "tags", "icon", "description"):
        if key in data:
            value = (data[key] or "").strip()
            data[key] = value or None

    if "color" in data:
        try:
            data["color"] = normalize_tool_color(data.get("color"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    apply_updates(
        db,
        tool,
        data,
        admin_id=admin.id or 0,
        target_type="tool",
        target_id=tool_id,
        max_value_len=200,
    )
    tool.updated_at = datetime.now(timezone.utc)
    db.add(tool)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="网址标识已存在，请换一个")
    db.refresh(tool)
    return tool


@router.delete("/{tool_id}")
def delete_tool(
    tool_id: int,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """删除工具"""
    tool = db.get(Tool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="工具不存在")

    name = tool.name
    db.delete(tool)
    db.commit()

    log_operation(
        db,
        admin_id=admin.id or 0,
        action="delete",
        target_type="tool",
        target_id=tool_id,
        changes={"name": {"old": name, "new": None}},
    )
    db.commit()
    return {"message": "已删除"}
