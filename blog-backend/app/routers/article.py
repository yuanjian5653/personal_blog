"""
文章路由
"""
import logging
import os
import re
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, func, select

from app.constants import WORD_EXTENSIONS
from app.database import get_session
from app.deps import get_current_admin
from app.models import Admin, Article
from app.schemas.article import (
    ArticleCreate,
    ArticleListItem,
    ArticleRead,
    ArticleUpdate,
)
from app.services.log_service import apply_updates, log_operation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/articles", tags=["文章"])


def calc_stats(content: str) -> tuple[int, int]:
    """计算字数和阅读时长"""
    text = re.sub(r"[#*`>\-\[\]()!]", "", content)
    cn_chars = len(re.findall(r"[\u4e00-\u9fa5]", text))
    en_words = len(re.findall(r"[a-zA-Z]+", text))
    word_count = cn_chars + en_words
    read_time = max(1, round(word_count / 400))
    return word_count, read_time


def make_slug(title: str) -> str:
    """生成 slug"""
    slug = re.sub(r"[^\w\u4e00-\u9fa5]+", "-", title).strip("-")
    if not slug:
        slug = uuid.uuid4().hex[:8]
    return slug[:100]


@router.get("", response_model=list[ArticleListItem])
def list_articles(
    category: str | None = None,
    tags: str | None = None,      # 逗号分隔的多个标签
    status: str = "published",
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_session),
):
    """
    文章列表（支持分类 + 多标签筛选）
    tags 参数用逗号分隔，比如 tags=mysql,python
    多标签为 AND 逻辑：文章必须包含所有选中的标签
    """
    stmt = select(Article)
    if category:
        stmt = stmt.where(Article.category == category)
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        for tag in tag_list:
            stmt = stmt.where(func.find_in_set(tag, Article.tags) > 0)
    if status:
        stmt = stmt.where(Article.status == status)
    stmt = (
        stmt.order_by(Article.is_pinned.desc(), Article.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return db.exec(stmt).all()

@router.get("/categories")
def list_categories(db: Session = Depends(get_session)):
    """所有分类及数量"""
    stmt = (
        select(Article.category, func.count(Article.id))
        .where(Article.status == "published")
        .where(Article.category.is_not(None))
        .group_by(Article.category)
    )
    rows = db.exec(stmt).all()
    return [{"name": r[0], "count": r[1]} for r in rows if r[0]]

@router.get("/tags")
def list_tags(db: Session = Depends(get_session)):
    """获取所有标签及数量"""
    stmt = (
        select(Article.tags)
        .where(Article.status == "published")
        .where(Article.tags.is_not(None))
    )
    rows = db.exec(stmt).all()
    counter: dict[str, int] = {}
    for row in rows:
        tags_str = row[0] if isinstance(row, tuple) else row
        if not tags_str:
            continue
        for t in tags_str.split(","):
            t = t.strip()
            if t:
                counter[t] = counter.get(t, 0) + 1
    return [
        {"name": name, "count": cnt}
        for name, cnt in sorted(counter.items(), key=lambda x: -x[1])
    ]


@router.get("/slug/{slug}", response_model=ArticleRead)
def get_by_slug(slug: str, db: Session = Depends(get_session)):
    article = db.exec(select(Article).where(Article.slug == slug)).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    return article


@router.get("/{article_id}", response_model=ArticleRead)
def get_article(article_id: int, db: Session = Depends(get_session)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    return article

@router.get("/{article_id}/related", response_model=list[ArticleListItem])
def get_related(
    article_id: int,
    limit: int = 5,
    db: Session = Depends(get_session),
):
    """相关文章：按共享标签数排序，无标签则返回最新"""
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    my_tags: set[str] = set()
    if article.tags:
        my_tags = {t.strip() for t in article.tags.split(",") if t.strip()}

    if not my_tags:
        # 没有标签，返回最新的其他文章
        stmt = (
            select(Article)
            .where(Article.status == "published")
            .where(Article.id != article_id)
            .order_by(Article.created_at.desc())
            .limit(limit)
        )
        return db.exec(stmt).all()

    # 拉出所有候选文章
    stmt = (
        select(Article)
        .where(Article.status == "published")
        .where(Article.id != article_id)
    )
    all_articles = db.exec(stmt).all()

    def score(a: Article) -> int:
        if not a.tags:
            return 0
        a_tags = {t.strip() for t in a.tags.split(",") if t.strip()}
        return len(my_tags & a_tags)

    scored = sorted(all_articles, key=lambda a: (-score(a), -a.id))
    return scored[:limit]

@router.post("/{article_id}/view")
def increment_view(article_id: int, db: Session = Depends(get_session)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    article.view_count += 1
    db.add(article)
    db.commit()
    return {"view_count": article.view_count}


@router.post("/{article_id}/like")
def increment_like(article_id: int, db: Session = Depends(get_session)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    article.like_count += 1
    db.add(article)
    db.commit()
    return {"like_count": article.like_count}


@router.post("", response_model=ArticleRead)
def create_article(
    data: ArticleCreate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    payload = data.model_dump()

    slug = payload.pop("slug", None) or make_slug(payload["title"])
    if db.exec(select(Article).where(Article.slug == slug)).first():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    wc, rt = calc_stats(payload.get("content", ""))

    article = Article(
        **payload,
        slug=slug,
        word_count=wc,
        read_time=rt,
    )
    db.add(article)
    db.flush()

    log_operation(
        db, current_admin.id, "create", "article", article.id,
        changes={"title": {"old": None, "new": article.title}},
    )
    db.commit()
    db.refresh(article)
    return article


@router.put("/{article_id}", response_model=ArticleRead)
def update_article(
    article_id: int,
    data: ArticleUpdate,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    update_data = data.model_dump(exclude_unset=True)

    # slug 唯一性
    if "slug" in update_data and update_data["slug"]:
        existing = db.exec(
            select(Article).where(
                Article.slug == update_data["slug"], Article.id != article_id
            )
        ).first()
        if existing:
            raise HTTPException(400, "slug 已存在")

    # 正文变了就重算字数
    if "content" in update_data and update_data["content"] is not None:
        wc, rt = calc_stats(update_data["content"])
        update_data["word_count"] = wc
        update_data["read_time"] = rt

    # 正文可能很长，日志里只留前 100 字符
    apply_updates(
        db,
        article,
        update_data,
        current_admin.id,
        "article",
        article_id,
        max_value_len=100,
    )

    db.commit()
    db.refresh(article)
    return article


@router.delete("/{article_id}")
def delete_article(
    article_id: int,
    db: Session = Depends(get_session),
    current_admin: Admin = Depends(get_current_admin),
):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    log_operation(
        db, current_admin.id, "delete", "article", article_id,
        changes={"title": {"old": article.title, "new": None}},
    )
    db.delete(article)
    db.commit()
    return {"message": "已删除"}

# ==================== Word 导入 ====================

MAX_WORD_SIZE = 20 * 1024 * 1024  # 20MB


@router.post("/parse-word")
async def parse_word(
    file: UploadFile = File(...),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    上传 .docx 文件，用 MarkItDown 转换为 Markdown。
    返回 {title, content}，不写数据库，由前端填入编辑器后再保存。

    注意：只做解析，不创建文章。
    """
    from markitdown import MarkItDown

    # 1. 检查扩展名
    original = Path(file.filename or "")
    ext = original.suffix.lower()
    if ext not in WORD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"仅支持 {', '.join(sorted(WORD_EXTENSIONS))} 格式",
        )

    # 2. 写到临时文件（MarkItDown 需要文件路径）
    content = await file.read()
    if len(content) > MAX_WORD_SIZE:
        raise HTTPException(status_code=400, detail="文件过大（>20MB）")

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        result = MarkItDown().convert(str(tmp_path))

        # markitdown 版本不同，字段名不同
        markdown = getattr(result, "text_content", None) or getattr(
            result, "markdown", ""
        )

        if not markdown.strip():
            raise HTTPException(status_code=400, detail="文档内容为空")

        return {
            "title": original.stem or "未命名文章",
            "content": markdown,
            "filename": original.name,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[Word 导入] 解析失败：%s", original.name)
        raise HTTPException(status_code=500, detail=f"解析失败：{e}")
    finally:
        # 清理临时文件（不存在也不报错）
        tmp_path.unlink(missing_ok=True)