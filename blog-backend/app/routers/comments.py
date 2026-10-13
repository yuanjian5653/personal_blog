"""
评论与点赞路由

访客用 GitHub 登录后可以：
- 发表评论、回复（一级）
- 给评论点赞 / 取消
- 给说说点赞 / 取消

登录态用**独立的** Cookie（commenter_token），与管理员的 session_token 完全分开，
互不影响：管理员登录不会让访客变成"已登录评论用户"，反之亦然。
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import RedirectResponse
from sqlalchemy import and_
from sqlmodel import Session, func, select

from app.config import settings
from app.database import get_session
from app.models import (
    Article,
    Comment,
    Commenter,
    CommenterSession,
    CommentLike,
    Essay,
    EssayLike,
    LifePost,
)
from app.schemas.comment import (
    CommentCreate,
    CommenterInfo,
    CommentListResponse,
    CommentRead,
    EssayLikesResponse,
    LikeResponse,
)
from app.services.pageview import client_ip
from app.services.github_oauth import (
    GitHubOAuthError,
    build_authorize_url,
    exchange_code_for_token,
    fetch_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/comments", tags=["评论"])

COMMENTER_COOKIE = "commenter_token"
OAUTH_STATE_COOKIE = "gh_oauth_state"
OAUTH_RETURN_COOKIE = "gh_oauth_return"
OAUTH_STATE_MAX_AGE = 600  # 10 分钟


def _safe_return_path(path: str | None) -> str:
    """只接受站内相对路径，避免被构造成跳去外站的开放重定向。

    要求：以 "/" 开头、且不以 "//" 或 "/\\" 开头（协议相对 URL）。
    """
    if not path:
        return "/"
    if not path.startswith("/"):
        return "/"
    if path.startswith("//") or path.startswith("/\\"):
        return "/"
    return path


# ============================================================
# 访客登录态
# ============================================================

def _as_aware(dt: datetime) -> datetime:
    """MySQL 的 DATETIME 取出来是 naive，统一补上 UTC 再比较"""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def get_current_commenter(
    commenter_token: str | None = Cookie(default=None, alias=COMMENTER_COOKIE),
    db: Session = Depends(get_session),
) -> Commenter | None:
    """可选登录：有有效登录态就返回 Commenter，否则 None（不抛 401）"""
    if not commenter_token:
        return None

    sess = db.exec(
        select(CommenterSession).where(
            CommenterSession.session_token == commenter_token
        )
    ).first()
    if sess is None:
        return None

    if _as_aware(sess.expires_at) < datetime.now(timezone.utc):
        # 过期顺手清理
        db.delete(sess)
        db.commit()
        return None

    return db.get(Commenter, sess.commenter_id)


def get_client_ip(request: Request) -> str | None:
    """客户端 IP（用作评论来源记录）。

    故意不读 X-Forwarded-For：那是客户端可伪造的请求头，
    直接采信等于允许伪造评论来源。部署到反向代理后面时，
    应在这里显式判断可信代理再读取。
    """
    return request.client.host if request.client else None


def require_commenter(
    commenter: Commenter | None = Depends(get_current_commenter),
) -> Commenter:
    """必须登录（用于发评论、点赞）"""
    if commenter is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先用 GitHub 登录",
        )
    return commenter


def _to_info(c: Commenter) -> CommenterInfo:
    return CommenterInfo(
        id=c.id or 0,
        login=c.login,
        name=c.name,
        avatar_url=c.avatar_url,
        html_url=c.html_url,
    )


def _set_commenter_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COMMENTER_COOKIE,
        value=token,
        max_age=settings.COMMENTER_SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
        secure=settings.COOKIE_SECURE,
        path="/",
    )


@router.get("/me", response_model=CommenterInfo | None)
def read_me(
    commenter: Commenter | None = Depends(get_current_commenter),
):
    """当前访客登录态（未登录返回 null，不报错）"""
    return _to_info(commenter) if commenter else None


@router.post("/logout")
def logout(
    response: Response,
    commenter_token: str | None = Cookie(default=None, alias=COMMENTER_COOKIE),
    db: Session = Depends(get_session),
):
    """退出访客登录"""
    if commenter_token:
        sess = db.exec(
            select(CommenterSession).where(
                CommenterSession.session_token == commenter_token
            )
        ).first()
        if sess:
            db.delete(sess)
            db.commit()
    response.delete_cookie(COMMENTER_COOKIE, path="/")
    return {"message": "已退出"}


# ============================================================
# GitHub OAuth
# ============================================================

def _explain_network_error(exc: Exception, url: str) -> str:
    """把"连不上 GitHub"翻译成可执行的排查步骤。

    这种错误对用户来说最难判断：浏览器能打开 GitHub，但后端连不上 ——
    通常是因为浏览器走了系统代理/PAC，而 httpx **不读**这些东西。
    """
    name = type(exc).__name__
    low = str(exc).lower()

    if "certificate" in low or "ssl" in low:
        return (
            f"TLS 证书校验失败（{name}）。目标 {url}。"
            "若你在用本机加速器/代理（它会替换 GitHub 的证书），"
            "本项目的证书加载已兼容系统证书存储；若仍失败，"
            "请运行 python scripts/diagnose_github_net.py 查看详情。"
        )

    if "timeout" in name.lower():
        reason = "连接超时"
    elif "connect" in name.lower():
        reason = "无法建立连接"
    else:
        reason = name

    return (
        f"后端连接 GitHub 失败：{reason}。目标地址 {url}。"
        "最常见原因：浏览器通过系统代理/PAC 访问 GitHub，"
        "而 Python 的 httpx **不会**读取它们。"
        "解决：运行 python scripts/diagnose_github_net.py 确认，"
        "然后在 .env 里填入代理地址，例如 "
        "GITHUB_PROXY=http://127.0.0.1:26561，重启后端。"
    )


@router.get("/github/login")
def github_login(return_to: str | None = Query(default=None)):
    """跳转到 GitHub 授权页。

    return_to：登录完成后要回到的站内路径（例如 /essays）。
    存在 HttpOnly Cookie 里，回调时再取出来用 —— 这样"从哪来回哪去"，
    不会再一律跳首页。
    """
    if not settings.github_oauth_enabled:
        raise HTTPException(
            status_code=503,
            detail="未配置 GitHub 登录（需要在 .env 里填 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）",
        )

    state = secrets.token_urlsafe(24)
    url = build_authorize_url(
        settings.GITHUB_CLIENT_ID, settings.github_redirect_uri, state
    )

    resp = RedirectResponse(url, status_code=302)
    # state 放 HttpOnly Cookie 防 CSRF；回调时比对
    resp.set_cookie(
        key=OAUTH_STATE_COOKIE,
        value=state,
        max_age=OAUTH_STATE_MAX_AGE,
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
        secure=settings.COOKIE_SECURE,
        path="/",
    )
    # 记住来路，回调后跳回去
    resp.set_cookie(
        key=OAUTH_RETURN_COOKIE,
        value=quote(_safe_return_path(return_to), safe=""),
        max_age=OAUTH_STATE_MAX_AGE,
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
        secure=settings.COOKIE_SECURE,
        path="/",
    )
    return resp


def _redirect_frontend(
    ok: bool, message: str, *, return_to: str = "/", token: str | None = None
) -> RedirectResponse:
    """回跳前端（回到发起登录的那个页面）。

    登录成功后 commenter_token 在这里种下 —— HttpOnly Cookie 只能由
    服务端设置，所以不能交给前端写。

    ⚠️ return_to / token 是**仅关键字**参数，必须写成
    `_redirect_frontend(True, "登录成功", return_to=..., token=...)`。
    之前这里是位置参数，结果 `(True, "登录成功", token)` 把 token 塞进了
    return_to，导致两个后果：登录 Cookie 根本没种下（登录后依然不能评论），
    以及跳转地址变成了 token 字符串拼出来的垃圾路径。
    """
    path = _safe_return_path(return_to)
    sep = "&" if "?" in path else "?"
    target = (
        f"{settings.FRONTEND_URL}{path}{sep}"
        f"comment_login={'ok' if ok else 'fail'}&msg={quote(message)}"
    )
    resp = RedirectResponse(target, status_code=302)
    resp.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    resp.delete_cookie(OAUTH_RETURN_COOKIE, path="/")
    if ok and token:
        _set_commenter_cookie(resp, token)
    return resp


@router.get("/github/callback")
async def github_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    gh_oauth_state: str | None = Cookie(default=None, alias=OAUTH_STATE_COOKIE),
    gh_oauth_return: str | None = Cookie(default=None, alias=OAUTH_RETURN_COOKIE),
    db: Session = Depends(get_session),
):
    """GitHub 授权回调：换 token → 取用户 → 建/更新 commenter → 写登录 Cookie"""
    # 来路（Cookie 里是 URL 编码过的）
    return_to = _safe_return_path(unquote(gh_oauth_return) if gh_oauth_return else None)

    if error:
        return _redirect_frontend(False, error_description or error, return_to=return_to)

    if not settings.github_oauth_enabled:
        return _redirect_frontend(False, "未配置 GitHub 登录", return_to=return_to)

    if not code or not state:
        return _redirect_frontend(False, "缺少 code 或 state", return_to=return_to)

    # CSRF：state 必须与发起时写入的 Cookie 一致
    if not gh_oauth_state or not secrets.compare_digest(state, gh_oauth_state):
        logger.warning(
            "[评论] OAuth state 校验失败：收到 state=%s，Cookie 里=%s。"
            "常见原因：state Cookie 丢失（跨站 Cookie 被拦），或同时开了多个登录标签页",
            (state or "")[:8],
            (gh_oauth_state or "")[:8] if gh_oauth_state else "(空)",
        )
        return _redirect_frontend(
            False, "登录校验失败（state 不匹配），请重新登录", return_to=return_to
        )

    try:
        access_token = await exchange_code_for_token(
            settings.GITHUB_CLIENT_ID,
            settings.GITHUB_CLIENT_SECRET,
            code,
            settings.github_redirect_uri,
        )
    except GitHubOAuthError as e:
        logger.warning("[评论] GitHub 登录失败: %s", e)
        return _redirect_frontend(False, str(e), return_to=return_to)
    except Exception as e:
        # 网络类错误：最常见的是连不上 github.com（防火墙/代理拦了 HTTPS 出站）
        logger.exception("[评论] 连接 GitHub 失败")
        return _redirect_frontend(
            False,
            _explain_network_error(e, settings.GITHUB_OAUTH_TOKEN_URL),
            return_to=return_to,
        )

    try:
        user = await fetch_user(access_token)
    except GitHubOAuthError as e:
        logger.warning("[评论] 获取 GitHub 用户信息失败: %s", e)
        return _redirect_frontend(False, str(e), return_to=return_to)
    except Exception as e:
        logger.exception("[评论] 连接 GitHub API 失败")
        return _redirect_frontend(
            False,
            _explain_network_error(e, settings.GITHUB_API_USER_URL),
            return_to=return_to,
        )

    commenter = db.exec(
        select(Commenter).where(Commenter.github_id == user["id"])
    ).first()

    if commenter is None:
        commenter = Commenter(
            github_id=user["id"],
            login=user.get("login") or f"user{user['id']}",
        )
        db.add(commenter)

    # 每次登录都刷新资料（用户可能改了头像/昵称）
    commenter.login = user.get("login") or commenter.login
    commenter.name = user.get("name")
    commenter.avatar_url = user.get("avatar_url")
    commenter.html_url = user.get("html_url")
    commenter.last_login_at = datetime.now(timezone.utc)
    db.add(commenter)
    db.commit()
    db.refresh(commenter)

    token = secrets.token_hex(32)
    db.add(
        CommenterSession(
            commenter_id=commenter.id,
            session_token=token,
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.COMMENTER_SESSION_DAYS),
        )
    )
    db.commit()

    logger.info("[评论] %s 登录成功", commenter.login)
    return _redirect_frontend(
        True, "登录成功", return_to=return_to, token=token
    )


# ============================================================
# 评论读写
# ============================================================

# ============================================================
# 评论读写（说说 / 生活动态两种目标共用同一套实现）
# ============================================================

def _check_target(
    db: Session,
    *,
    essay_id: int | None = None,
    life_post_id: int | None = None,
    article_id: int | None = None,
    guestbook: bool = False,
) -> None:
    """确认评论要挂的目标存在（guestbook 没有实体，无需检查）"""
    if guestbook:
        return
    if essay_id is not None:
        if db.get(Essay, essay_id) is None:
            raise HTTPException(status_code=404, detail="说说不存在")
    elif life_post_id is not None:
        if db.get(LifePost, life_post_id) is None:
            raise HTTPException(status_code=404, detail="生活动态不存在")
    elif article_id is not None:
        if db.get(Article, article_id) is None:
            raise HTTPException(status_code=404, detail="文章不存在")
    else:
        raise HTTPException(status_code=400, detail="缺少评论目标")


def _target_where(
    *,
    essay_id: int | None = None,
    life_post_id: int | None = None,
    article_id: int | None = None,
    guestbook: bool = False,
):
    """生成筛选条件。

    ⚠️ 这里必须"要么正好命中一个目标，要么显式声明是留言板"。
    如果用 if/elif 逐个判断，将来新增第四种目标时漏改一处就会
    **静默查到全表评论** —— 那是最危险的失败方式，所以宁可报错。

    留言板 = 三个外键全为 NULL。
    """
    cols = [
        (Comment.essay_id, essay_id),
        (Comment.life_post_id, life_post_id),
        (Comment.article_id, article_id),
    ]
    present = [(col, val) for col, val in cols if val is not None]

    if guestbook:
        # 留言板：三个都必须为空
        cond = Comment.essay_id.is_(None)
        for col, _ in cols[1:]:
            cond = and_(cond, col.is_(None))
        return cond

    if len(present) != 1:
        given = sorted(v for _, v in cols if v is not None)
        raise HTTPException(
            status_code=400,
            detail=f"必须且只能指定一个评论目标（收到 {given}）",
        )
    col, val = present[0]
    return col == val


def _target_type_of(c: Comment) -> str:
    """判断一条评论属于哪种目标"""
    if c.essay_id is not None:
        return "essay"
    if c.life_post_id is not None:
        return "life"
    if c.article_id is not None:
        return "article"
    return "guestbook"


def _build_comment_tree(
    rows: list[Comment],
    viewer: Commenter | None,
    like_counts: dict[int, int],
    my_likes: set[int],
) -> list[CommentRead]:
    """把评论列表组装成"顶层 + 各自一级回复"""

    def build(c: Comment) -> CommentRead:
        return CommentRead(
            id=c.id or 0,
            essay_id=c.essay_id,
            life_post_id=c.life_post_id,
            article_id=c.article_id,
            target_type=_target_type_of(c),
            parent_id=c.parent_id,
            content=c.content,
            author_login=c.author_login,
            author_name=c.author_name,
            author_avatar=c.author_avatar,
            author_html_url=(
                f"https://github.com/{c.author_login}" if c.author_login else None
            ),
            likes=like_counts.get(c.id or 0, 0),
            liked=(c.id or 0) in my_likes,
            mine=bool(viewer and viewer.id == c.commenter_id),
            created_at=c.created_at,
            replies=[],
        )

    top: list[CommentRead] = []
    children: dict[int, list[CommentRead]] = {}
    for c in rows:
        item = build(c)
        if c.parent_id:
            children.setdefault(c.parent_id, []).append(item)
        else:
            top.append(item)

    for t in top:
        t.replies = children.get(t.id, [])
    return top


def _load_comments(
    db: Session,
    viewer: Commenter | None,
    *,
    essay_id: int | None = None,
    life_post_id: int | None = None,
    article_id: int | None = None,
    guestbook: bool = False,
    include_rejected: bool = False,
) -> CommentListResponse:
    """读取某个目标下的评论（含点赞数与"我是否赞过"）"""
    _check_target(
        db,
        essay_id=essay_id,
        life_post_id=life_post_id,
        article_id=article_id,
        guestbook=guestbook,
    )

    where = _target_where(
        essay_id=essay_id,
        life_post_id=life_post_id,
        article_id=article_id,
        guestbook=guestbook,
    )

    # 留言板按时间倒序（最新留言在最上面，符合留言板直觉）；
    # 其他目标按时间正序（评论区里对话顺序更自然）。
    #
    # ⚠️ 必须带 id 作为第二排序键：MySQL 的 DATETIME 默认没有小数秒精度，
    # 同一秒内发的两条留言 created_at 完全相同，只按时间排序时
    # 顺序是不确定的（实测会出现"新留言排在旧留言下面"）。id 单调递增，
    # 用它兜底就能保证顺序稳定且符合直觉。
    if guestbook:
        order = (Comment.created_at.desc(), Comment.id.desc())
    else:
        order = (Comment.created_at.asc(), Comment.id.asc())
    # 前台只展示已通过审核的评论；后台评论管理传 include_rejected=True 看全部
    if not include_rejected:
        where = and_(where, Comment.status == "approved")

    rows = db.exec(select(Comment).where(where).order_by(*order)).all()

    # 点赞数：一次查出所有，避免 N+1
    comment_ids = [c.id for c in rows if c.id]
    like_counts: dict[int, int] = {}
    my_likes: set[int] = set()

    if comment_ids:
        count_rows = db.exec(
            select(CommentLike.comment_id, func.count(CommentLike.id))
            .where(CommentLike.comment_id.in_(comment_ids))
            .group_by(CommentLike.comment_id)
        ).all()
        like_counts = {cid: n for cid, n in count_rows}

        if viewer:
            # 注意：只 select 单列时 SQLModel 返回的是标量（不是元组），别写成 for (cid,)
            my_likes = set(
                db.exec(
                    select(CommentLike.comment_id).where(
                        CommentLike.comment_id.in_(comment_ids),
                        CommentLike.commenter_id == viewer.id,
                    )
                ).all()
            )

    return CommentListResponse(
        total=len(rows),
        comments=_build_comment_tree(rows, viewer, like_counts, my_likes),
        viewer=_to_info(viewer) if viewer else None,
    )


def _add_comment(
    db: Session,
    commenter: Commenter,
    data: CommentCreate,
    *,
    essay_id: int | None = None,
    life_post_id: int | None = None,
    article_id: int | None = None,
    guestbook: bool = False,
    ip: str | None = None,
) -> CommentRead:
    """发表评论 / 回复"""
    _check_target(
        db,
        essay_id=essay_id,
        life_post_id=life_post_id,
        article_id=article_id,
        guestbook=guestbook,
    )

    content = data.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")

    parent_id = data.parent_id
    if parent_id is not None:
        parent = db.get(Comment, parent_id)
        # 父评论必须属于**同一个目标**，否则就跨目标串评论了
        same_target = parent is not None and (
            (essay_id is not None and parent.essay_id == essay_id)
            or (life_post_id is not None and parent.life_post_id == life_post_id)
            or (article_id is not None and parent.article_id == article_id)
            or (
                guestbook
                and parent.essay_id is None
                and parent.life_post_id is None
                and parent.article_id is None
            )
        )
        if not same_target:
            raise HTTPException(status_code=400, detail="要回复的评论不存在")
        # 只支持一级：如果父评论本身是回复，就挂到它的顶层父级上
        if parent.parent_id:
            parent_id = parent.parent_id

    comment = Comment(
        essay_id=essay_id,
        life_post_id=life_post_id,
        article_id=article_id,
        commenter_id=commenter.id,
        parent_id=parent_id,
        content=content,
        author_login=commenter.login,
        author_name=commenter.name,
        author_avatar=commenter.avatar_url,
        ip=ip,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return CommentRead(
        id=comment.id or 0,
        essay_id=comment.essay_id,
        life_post_id=comment.life_post_id,
        article_id=comment.article_id,
        target_type=_target_type_of(comment),
        parent_id=comment.parent_id,
        content=comment.content,
        author_login=comment.author_login,
        author_name=comment.author_name,
        author_avatar=comment.author_avatar,
        author_html_url=f"https://github.com/{comment.author_login}",
        likes=0,
        liked=False,
        mine=True,
        status=comment.status,
        created_at=comment.created_at,
        replies=[],
    )


# ---- 说说 ----

@router.get("/essay/{essay_id}", response_model=CommentListResponse)
def list_essay_comments(
    essay_id: int,
    db: Session = Depends(get_session),
    viewer: Commenter | None = Depends(get_current_commenter),
):
    """某条说说的评论（顶层 + 各自的一级回复）"""
    return _load_comments(db, viewer, essay_id=essay_id)


@router.post("/essay/{essay_id}", response_model=CommentRead)
def create_essay_comment(
    essay_id: int,
    data: CommentCreate,
    ip: str | None = Depends(get_client_ip),
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """给说说发表评论 / 回复（需登录）"""
    return _add_comment(db, commenter, data, essay_id=essay_id, ip=ip)


# ---- 生活动态 ----

@router.get("/life/{life_post_id}", response_model=CommentListResponse)
def list_life_comments(
    life_post_id: int,
    db: Session = Depends(get_session),
    viewer: Commenter | None = Depends(get_current_commenter),
):
    """某条生活动态的评论（顶层 + 各自的一级回复）"""
    return _load_comments(db, viewer, life_post_id=life_post_id)


@router.post("/life/{life_post_id}", response_model=CommentRead)
def create_life_comment(
    life_post_id: int,
    data: CommentCreate,
    ip: str | None = Depends(get_client_ip),
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """给生活动态发表评论 / 回复（需登录）"""
    return _add_comment(db, commenter, data, life_post_id=life_post_id, ip=ip)


# ---- 文章 ----

@router.get("/article/{article_id}", response_model=CommentListResponse)
def list_article_comments(
    article_id: int,
    db: Session = Depends(get_session),
    viewer: Commenter | None = Depends(get_current_commenter),
):
    """某篇文章的评论（顶层 + 各自的一级回复）"""
    return _load_comments(db, viewer, article_id=article_id)


@router.post("/article/{article_id}", response_model=CommentRead)
def create_article_comment(
    article_id: int,
    data: CommentCreate,
    ip: str | None = Depends(get_client_ip),
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """给文章发表评论 / 回复（需登录）"""
    return _add_comment(db, commenter, data, article_id=article_id, ip=ip)


# ---- 杂谈 / 留言板 ----
#
# 留言板没有自己的内容实体（没有标题正文），它本身就是一堆评论，
# 所以用"三个外键全为 NULL"来表示，不需要额外的表。

@router.get("/guestbook", response_model=CommentListResponse)
def list_guestbook(
    db: Session = Depends(get_session),
    viewer: Commenter | None = Depends(get_current_commenter),
):
    """留言板列表（最新在前）"""
    return _load_comments(db, viewer, guestbook=True)


@router.post("/guestbook", response_model=CommentRead)
def create_guestbook_message(
    data: CommentCreate,
    ip: str | None = Depends(get_client_ip),
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """发表留言 / 回复留言（需登录）"""
    return _add_comment(db, commenter, data, guestbook=True, ip=ip)


# ---- 通用 ----

@router.delete("/{comment_id}")
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """删除自己的评论（同时删掉它下面的一级回复与点赞）"""
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="评论不存在")
    if comment.commenter_id != commenter.id:
        raise HTTPException(status_code=403, detail="只能删除自己的评论")

    # ⚠️ 删除顺序必须配合 flush，否则会撞外键：
    #   comments.parent_id 自引用，comment_likes 也引用 comments。
    #   SQLAlchemy 默认 autoflush —— 只要中间有一次查询，session 里
    #   "待删除"的父评论就会被提前 flush 成真正的 DELETE，而此时回复
    #   和点赞还在，MySQL 直接报 1451。
    #   所以这里先用 no_autoflush 把要删的 id 查清楚，再按
    #   点赞 → 回复 → 父评论 的顺序删，每步 commit。
    with db.no_autoflush:
        replies = db.exec(select(Comment).where(Comment.parent_id == comment_id)).all()
        ids = [comment_id] + [r.id for r in replies if r.id]
        likes = db.exec(
            select(CommentLike).where(CommentLike.comment_id.in_(ids))
        ).all()

    # 1) 点赞
    for like in likes:
        db.delete(like)
    db.commit()

    # 2) 回复（先于父评论）
    for r in replies:
        db.delete(r)
    db.commit()

    # 3) 父评论
    db.delete(comment)
    db.commit()
    return {"message": "已删除"}


# ============================================================
# 点赞
# ============================================================

@router.post("/{comment_id}/like", response_model=LikeResponse)
def toggle_comment_like(
    comment_id: int,
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """给评论点赞 / 取消点赞（需登录，一人一次）"""
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="评论不存在")

    existing = db.exec(
        select(CommentLike).where(
            CommentLike.comment_id == comment_id,
            CommentLike.commenter_id == commenter.id,
        )
    ).first()

    if existing:
        db.delete(existing)
        liked = False
    else:
        db.add(CommentLike(comment_id=comment_id, commenter_id=commenter.id))
        liked = True
    db.commit()

    total = db.exec(
        select(func.count(CommentLike.id)).where(
            CommentLike.comment_id == comment_id
        )
    ).one()

    return LikeResponse(likes=total, liked=liked)


@router.post("/essay/{essay_id}/like", response_model=EssayLikesResponse)
def toggle_essay_like(
    essay_id: int,
    db: Session = Depends(get_session),
    commenter: Commenter = Depends(require_commenter),
):
    """给说说点赞 / 取消（需登录，一人一次）。

    点赞数**实时统计** essay_likes 行数，而不是读写 essays.likes 冗余字段 ——
    冗余字段一旦和明细表不同步，就会出现"显示 5 个赞、实际只有 3 条记录"
    这种对不上的情况。条数很少，count 的开销可以忽略。
    """
    essay = db.get(Essay, essay_id)
    if essay is None:
        raise HTTPException(status_code=404, detail="说说不存在")

    existing = db.exec(
        select(EssayLike).where(
            EssayLike.essay_id == essay_id,
            EssayLike.commenter_id == commenter.id,
        )
    ).first()

    if existing:
        db.delete(existing)
        liked = False
    else:
        db.add(EssayLike(essay_id=essay_id, commenter_id=commenter.id))
        liked = True
    db.commit()

    total = db.exec(
        select(func.count(EssayLike.id)).where(EssayLike.essay_id == essay_id)
    ).one()

    return EssayLikesResponse(likes=total, liked=liked)


@router.get("/essay/{essay_id}/like", response_model=EssayLikesResponse)
def read_essay_likes(
    essay_id: int,
    db: Session = Depends(get_session),
    viewer: Commenter | None = Depends(get_current_commenter),
):
    """说说的点赞数与"我是否赞过"（未登录时 liked 恒为 false）"""
    essay = db.get(Essay, essay_id)
    if essay is None:
        raise HTTPException(status_code=404, detail="说说不存在")

    total = db.exec(
        select(func.count(EssayLike.id)).where(EssayLike.essay_id == essay_id)
    ).one()

    liked = False
    if viewer:
        liked = (
            db.exec(
                select(EssayLike).where(
                    EssayLike.essay_id == essay_id,
                    EssayLike.commenter_id == viewer.id,
                )
            ).first()
            is not None
        )

    return EssayLikesResponse(likes=total, liked=liked)
