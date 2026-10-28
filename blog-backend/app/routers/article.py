"""
文章路由
"""
import logging
import os
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, func, select

from app.constants import MARKDOWN_EXTENSIONS
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

# ==================== Markdown 导入 ====================

MAX_DOCUMENT_SIZE = 20 * 1024 * 1024  # 20MB


def _decode_text(raw: bytes) -> str:
    """把上传的纯文本解码成 str。

    Markdown 文件在中文环境里编码很杂：UTF-8 最常见，但 Windows 上
    用记事本/老编辑器另存为的常常是 **GBK**，而 UTF-8 解码 GBK 字节
    通常不会报错、只会得到一堆乱码 —— 那比直接报错更难排查。
    所以这里按 BOM → UTF-8 → GBK 的顺序试，并显式失败，
    避免"能导入但内容全是乱码"。
    """
    # 1) 带 BOM 的 UTF-8 / UTF-16，交给 utf-8-sig 或 utf-16 处理
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig")
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")

    # 2) 严格 UTF-8（不用 errors="ignore"，否则会掩盖编码问题）
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass

    # 3) 退回 GBK（中文 Windows 常见）
    try:
        return raw.decode("gbk")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="文件编码无法识别，请另存为 UTF-8 后再上传",
        )


def _title_from_markdown(text: str, fallback: str) -> str:
    """从 Markdown 里推断标题。

    优先取第一个一级标题（`# xxx`）；没有就用文件名。
    找不到一级标题时会退回第一个非空行（截断），比文件名更贴近内容。
    """
    first_line = None
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if first_line is None:
            first_line = s
        if s.startswith("# "):
            title = s[2:].strip()
            # 去掉标题里可能的行尾 # 号（## xxx ## 这种写法）
            title = re.sub(r"\s*#+\s*$", "", title).strip()
            if title:
                return title[:200]
            break

    if first_line:
        # 去掉常见 Markdown 前缀，避免标题里带 `#` `>` `-` 等符号
        cleaned = re.sub(r"^[#>\-\*\s]+", "", first_line).strip()
        if cleaned:
            return cleaned[:200]

    return fallback


@router.post("/parse-document")
async def parse_document(
    file: UploadFile = File(...),
    current_admin: Admin = Depends(get_current_admin),
):
    """
    上传 Markdown 文档并转成文章正文。

    只支持 .md / .markdown —— 它本身就是编辑器使用的格式，直接读文本，
    不做任何改写、不加任何依赖。

    返回 {title, content, filename}，**不写数据库**，
    由前端填入编辑器、确认分类标签后再保存。

    注意：只做解析，不创建文章。
    """
    original = Path(file.filename or "")
    ext = original.suffix.lower()

    if ext not in MARKDOWN_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"仅支持 {', '.join(sorted(MARKDOWN_EXTENSIONS))} 格式",
        )

    raw = await file.read()
    if len(raw) > MAX_DOCUMENT_SIZE:
        raise HTTPException(status_code=400, detail="文件过大（>20MB）")
    if not raw:
        raise HTTPException(status_code=400, detail="文件是空的")

    fallback_title = original.stem or "未命名文章"

    text = _decode_text(raw)
    if not text.strip():
        raise HTTPException(status_code=400, detail="文件内容为空")

    # 原样返回，不做任何格式转换或清理 ——
    # 用户写好的 Markdown 不该被我们改写；只统一换行符。
    content = text.replace("\r\n", "\n")
    return {
        "title": _title_from_markdown(content, fallback_title),
        "content": content,
        "filename": original.name,
        "source": "markdown",
    }