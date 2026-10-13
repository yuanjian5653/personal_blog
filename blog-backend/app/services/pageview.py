"""
访问统计服务

用于后台仪表盘的"访客趋势"与"浏览器分布"。
"""
import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlmodel import Session, select

from app.models import PageView

# 同一个访客在 DEDUP_WINDOW 内重复访问同一路径，只记一次 ——
# 避免页面刷新、SPA 内部跳转把数据灌水。
DEDUP_WINDOW = timedelta(hours=6)


def client_ip(request: Request) -> str | None:
    """取客户端真实 IP。

    只用 request.client.host，**不信任** X-Forwarded-For ——
    那是个可以被客户端随意伪造的请求头，直接采信等于允许刷统计/伪造评论来源。
    如果以后部署在 Nginx 后面，应该在这里显式判断可信代理再读取。
    """
    return request.client.host if request.client else None


def parse_browser(user_agent: str | None) -> str:
    """从 UA 里粗略识别浏览器。

    刻意不引入 UA 解析库：这里只需要够用的分类，
    而且顺序很重要（Edge/OPR 的 UA 里都含 Chrome）。
    """
    ua = (user_agent or "").lower()
    if not ua:
        return "Unknown"
    if "edg/" in ua or "edgios" in ua:
        return "Edge"
    if "opr/" in ua or "opera" in ua:
        return "Opera"
    if "firefox" in ua:
        return "Firefox"
    if "chrome" in ua or "crios" in ua:
        return "Chrome"
    if "safari" in ua:
        return "Safari"
    if any(k in ua for k in ("bot", "spider", "crawler", "curl", "wget", "python-requests")):
        return "Bot"
    return "Other"


def _visitor_hash(ip: str | None, user_agent: str | None, day: str) -> str:
    """按天生成访客标识。

    把日期掺进来是有意的：这样同一个人不同天算不同访客（无法跨天追踪），
    只在"当天去重"这个用途上够用。
    """
    raw = f"{ip or ''}|{user_agent or ''}|{day}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def record_pageview(
    db: Session,
    request: Request,
    path: str,
    is_login: bool = False,
) -> bool:
    """记录一次访问。返回是否真的写入了（去重命中时返回 False）。"""
    ip = client_ip(request)
    ua = request.headers.get("user-agent")
    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")

    visitor = _visitor_hash(ip, ua, day)

    # 去重：同一访客 + 同一路径，在窗口期内已有记录就跳过
    cutoff = now - DEDUP_WINDOW
    recent = db.exec(
        select(PageView).where(
            PageView.visitor_hash == visitor,
            PageView.path == path,
            PageView.created_at >= cutoff,
        )
    ).first()
    if recent is not None:
        return False

    db.add(
        PageView(
            path=path[:300],
            visitor_hash=visitor,
            ip=ip,
            browser=parse_browser(ua),
            is_login=is_login,
        )
    )
    db.commit()
    return True
