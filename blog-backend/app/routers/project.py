"""
项目路由（/projects 页面 + 后台项目管理）

公开接口：
  GET  /api/projects            前台列表（只返回展示中的，已排好序）

后台接口（需管理员）：
  GET    /api/projects/all      全部（含隐藏）
  POST   /api/projects/sync     从 GitHub 拉取并同步（保留人工设置）
  PUT    /api/projects/{id}     改展示配置
  POST   /api/projects/reorder  批量调整顺序
  DELETE /api/projects/{id}     删除（下次同步会重新出现）
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, Project
from app.schemas.project import (
    ProjectRead,
    ProjectSyncResult,
    ProjectUpdate,
)
from app.services import github_repos
from app.services.log_service import apply_updates, log_operation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["项目"])


def _to_read(p: Project) -> ProjectRead:
    """把 ORM 对象转成响应模型（解析 topics_json）"""
    try:
        topics = json.loads(p.topics_json) if p.topics_json else []
    except (ValueError, TypeError):
        topics = []
    return ProjectRead(
        id=p.id or 0,
        full_name=p.full_name,
        name=p.name,
        title=p.title,
        summary=p.summary,
        description=p.description,
        html_url=p.html_url,
        homepage=p.homepage,
        language=p.language,
        stars=p.stars,
        forks=p.forks,
        topics=topics,
        license=p.license,
        pushed_at=p.pushed_at,
        is_visible=p.is_visible,
        is_pinned=p.is_pinned,
        sort_order=p.sort_order,
    )


def _sort_key(p: Project):
    """排序：置顶优先 → 手动 sort_order → star 数 → 名称。

    全部带上兜底键，避免"各项都相同"时每次查询顺序漂移。
    """
    return (not p.is_pinned, p.sort_order, -p.stars, p.name)


def _parse_dt(value: str | None) -> datetime | None:
    """解析 GitHub 的 ISO 时间（形如 2024-01-02T03:04:05Z）。

    统一返回**带时区的 UTC** —— SQLModel 拒绝 naive datetime，
    所以不能用 .replace(tzinfo=None) 去掉时区。
    """
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# ============================================================
# 公开接口
# ============================================================

@router.get("", response_model=list[ProjectRead])
def list_projects(db: Session = Depends(get_session)):
    """前台项目列表：只返回展示中的"""
    rows = db.exec(select(Project).where(Project.is_visible == True)).all()  # noqa: E712
    return [_to_read(p) for p in sorted(rows, key=_sort_key)]


# ============================================================
# 后台接口
# ============================================================

@router.get("/all", response_model=list[ProjectRead])
def list_all_projects(
    db: Session = Depends(get_session),
    _admin: Admin = Depends(get_current_admin),
):
    """后台列表：包含隐藏的"""
    rows = db.exec(select(Project)).all()
    return [_to_read(p) for p in sorted(rows, key=_sort_key)]


@router.get("/config")
def get_config(_admin: Admin = Depends(get_current_admin)):
    """告诉后台：当前配置了哪个 GitHub 账号、有没有 token。

    有这些信息，后台才能给出准确的提示（比如"没配账号，先去站点配置填"）。
    """
    return {
        "username": settings.GITHUB_USERNAME,
        "has_token": bool(settings.GITHUB_TOKEN),
        "languages": settings.GITHUB_REPO_LANGUAGES,
    }


@router.post("/sync", response_model=ProjectSyncResult)
async def sync_projects(
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """从 GitHub 拉取仓库并同步到本地。

    只更新 GitHub 侧的字段；**人工设置（是否展示 / 排序 / 自定义文案 / 置顶）
    一律保留** —— 否则每次同步都会把后台的调整冲掉。
    """
    username = settings.GITHUB_USERNAME.strip()
    if not username:
        raise HTTPException(
            status_code=400,
            detail="还没有配置 GitHub 账号。请在 blog-backend/.env 里设置 "
                   "GITHUB_USERNAME=你的用户名，然后重启后端。",
        )

    try:
        repos = await github_repos.fetch_repos(username, force=True)
    except RuntimeError as e:
        # 把网络/额度问题转成可读的 502
        raise HTTPException(status_code=502, detail=str(e)) from e

    created = updated = 0
    for r in repos:
        existing = db.exec(
            select(Project).where(Project.full_name == r["full_name"])
        ).first()
        fields = {
            "name": r["name"],
            "description": r["description"],
            "html_url": r["html_url"],
            "homepage": r["homepage"],
            "language": r["language"],
            "stars": r["stars"],
            "forks": r["forks"],
            "topics_json": json.dumps(r["topics"], ensure_ascii=False)[:1000],
            "license": r["license"],
            "pushed_at": _parse_dt(r["pushed_at"]),
            "synced_at": datetime.now(timezone.utc),
        }
        if existing is None:
            db.add(Project(full_name=r["full_name"], **fields))
            created += 1
        else:
            for k, v in fields.items():
                setattr(existing, k, v)
            existing.updated_at = datetime.now(timezone.utc)
            updated += 1

    db.commit()

    log_operation(
        db,
        admin_id=admin.id or 0,
        action="sync",
        target_type="project",
        target_id=0,
        changes={
            "username": {"old": None, "new": username},
            "created": {"old": None, "new": created},
            "updated": {"old": None, "new": updated},
        },
    )
    db.commit()

    logger.info("[项目] 同步 %s：新增 %d，更新 %d", username, created, updated)
    return ProjectSyncResult(
        total=len(repos), created=created, updated=updated, username=username
    )


@router.put("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """改展示配置（不碰 GitHub 同步来的字段）"""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")

    data = payload.model_dump(exclude_unset=True)
    apply_updates(
        db,
        project,
        data,
        admin_id=admin.id or 0,
        target_type="project",
        target_id=project_id,
        max_value_len=200,
    )
    project.updated_at = datetime.now(timezone.utc)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _to_read(project)


@router.post("/reorder")
def reorder_projects(
    order: list[int],
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """按传入的 id 顺序批量重排（sort_order = 下标）"""
    for index, pid in enumerate(order):
        project = db.get(Project, pid)
        if project is not None:
            project.sort_order = index
    db.commit()
    log_operation(
        db,
        admin_id=admin.id or 0,
        action="reorder",
        target_type="project",
        target_id=0,
        changes={"count": {"old": None, "new": len(order)}},
    )
    db.commit()
    return {"message": f"已重排 {len(order)} 个项目"}


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_session),
    admin: Admin = Depends(get_current_admin),
):
    """删除。注意：下次同步会把它重新拉回来（GitHub 上还在）。

    想永久隐藏请用 is_visible=false，而不是删除。
    """
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")

    name = project.full_name
    db.delete(project)
    db.commit()

    log_operation(
        db,
        admin_id=admin.id or 0,
        action="delete",
        target_type="project",
        target_id=project_id,
        changes={"full_name": {"old": name, "new": None}},
    )
    db.commit()
    return {"message": "已删除。注意：下次同步会重新出现，想隐藏请改用「不显示」。"}
