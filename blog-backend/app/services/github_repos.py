"""
GitHub 仓库拉取（/projects 页面用）

复用 github_oauth 里的 _client / _ssl_context：
那套东西是为了解决"本机加速器做 HTTPS 中间人导致证书校验失败"而写的，
这里同样是访问 api.github.com，直接复用最省事，也不会两处行为不一致。

关于缓存：匿名调用 GitHub 只有 60 次/小时的额度，每次刷页面都请求很容易打满。
所以这里做 10 分钟内存缓存；后台"同步"接口可以强制绕过缓存。
"""
import logging
import time
from typing import Any

import httpx

from app.config import settings
from app.services.github_oauth import _client  # noqa: PLC2701 (同包内部复用)

logger = logging.getLogger(__name__)

API_BASE = "https://api.github.com"

# 缓存：{cache_key: (expire_at, data)}
_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
CACHE_TTL = 600  # 10 分钟


def _headers() -> dict[str, str]:
    """GitHub API 要求带 UA；有 token 就带上（额度从 60/h 提到 5000/h）"""
    h = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "personal-blog",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if settings.GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"
    return h


def _wanted_languages() -> set[str]:
    raw = (settings.GITHUB_REPO_LANGUAGES or "").strip()
    if not raw:
        return set()
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def normalize_repo(raw: dict[str, Any]) -> dict[str, Any]:
    """把 GitHub 的仓库 JSON 压成前端需要的那几个字段。

    只保留必要字段：一是省流量，二是避免把 GitHub 返回的一大坨
    直接透出去（里面有些字段跟展示无关）。
    """
    return {
        "full_name": raw.get("full_name") or "",
        "name": raw.get("name") or "",
        "description": raw.get("description"),
        "html_url": raw.get("html_url") or "",
        "homepage": raw.get("homepage") or None,
        "language": raw.get("language"),
        "stars": raw.get("stargazers_count") or 0,
        "forks": raw.get("forks_count") or 0,
        "topics": raw.get("topics") or [],
        "is_fork": bool(raw.get("fork")),
        "is_archived": bool(raw.get("archived")),
        "pushed_at": raw.get("pushed_at"),
        "created_at": raw.get("created_at"),
        "license": (raw.get("license") or {}).get("spdx_id"),
    }


async def _request(url: str, params: dict[str, Any]) -> httpx.Response:
    """请求 GitHub，并处理"代理配了但不可用"的情况。

    为什么需要这个 fallback：
      GITHUB_PROXY 是给 **OAuth 换 token** 用的（github.com 被墙时需要走代理），
      但 `api.github.com` 往往**直连就能通、反而走代理会失败**。
      实测：同一台机器上 api.github.com 直连 200，而配置的代理端口已关闭
      （WinError 10061 目标计算机积极拒绝）。此时如果死用代理，
      项目页就永远是"拉取失败"。

      所以策略是：先用配置的方式（有代理就带代理）试一次；
      如果是"连不上"这类错误，再**不带代理**重试一次。
      注意只对连接类错误重试 —— 404/403 这类是业务结果，不该重试。
    """
    attempts: list[dict[str, Any]] = []
    if settings.GITHUB_PROXY:
        attempts.append({})
        # 强制直连：_client 默认会带上 GITHUB_PROXY，这里用 no_proxy 关掉它
        attempts.append({"no_proxy": True})
    else:
        attempts.append({})

    last_error: Exception | None = None
    for kw in attempts:
        mode = "直连" if kw.get("no_proxy") else ("代理" if settings.GITHUB_PROXY else "直连")
        try:
            async with _client(headers=_headers(), **kw) as client:
                return await client.get(url, params=params)
        except httpx.TimeoutException as e:
            last_error = e
            logger.warning("[GitHub] %s 请求超时（%s）", url, mode)
        except httpx.ConnectError as e:
            last_error = e
            logger.warning("[GitHub] %s 连接失败（%s）：%s", url, mode, e)
        except httpx.HTTPError as e:
            last_error = e
            logger.warning("[GitHub] %s 请求出错（%s）：%s", url, mode, e)

    raise RuntimeError(
        "连不上 api.github.com。"
        + (
            "已尝试「配置的代理」与「直连」两种方式，都失败。"
            "若你的代理软件（如 Watt Toolkit）没在运行，"
            "可以清空 .env 里的 GITHUB_PROXY；"
            "若是网络需要代理，请确认代理端口正确。"
            if settings.GITHUB_PROXY
            else "当前是直连模式。若你的网络需要代理才能访问 GitHub，"
            "请在 .env 里设置 GITHUB_PROXY=http://127.0.0.1:端口。"
        )
        + " 可先跑 scripts/diagnose_github_net.py 确认连通性。"
        f"（最后一次错误：{type(last_error).__name__}）"
    ) from last_error


async def fetch_repos(username: str, *, force: bool = False) -> list[dict[str, Any]]:
    """拉取某个账号的公开仓库。

    过滤掉 fork 与归档仓库（展示"我的项目"时这两类通常是噪音），
    按 star 数降序、其次按最近推送时间降序。

    失败时抛 RuntimeError，由路由层转成 HTTP 错误并给出可读原因。
    """
    if not username:
        return []

    now = time.time()
    key = username.lower()
    if not force:
        hit = _CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1]

    # 一次拉 100 个（GitHub 单页上限），按最近更新排序取前 100 个足够
    url = f"{API_BASE}/users/{username}/repos"
    params = {"per_page": 100, "sort": "updated", "type": "owner"}

    resp = await _request(url, params)

    if resp.status_code == 404:
        raise RuntimeError(f"GitHub 上找不到用户「{username}」")
    if resp.status_code == 403:
        # 最常见的就是额度用尽
        remaining = resp.headers.get("x-ratelimit-remaining")
        if remaining == "0":
            raise RuntimeError(
                "GitHub 接口额度已用尽（匿名每小时 60 次）。"
                "在 .env 里填 GITHUB_TOKEN 可以提高到 5000 次/小时。"
            )
        raise RuntimeError("GitHub 拒绝了请求（403），可能是额度或权限问题")
    if resp.status_code != 200:
        raise RuntimeError(f"GitHub 返回了 {resp.status_code}")

    try:
        raw_list = resp.json()
    except ValueError as e:
        raise RuntimeError("GitHub 返回的不是合法 JSON") from e

    if not isinstance(raw_list, list):
        raise RuntimeError("GitHub 返回的数据格式不是预期（应为仓库数组）")

    repos = [normalize_repo(r) for r in raw_list]
    # fork 默认不展示（通常不是"自己的项目"）；归档的也去掉（已不维护）。
    # 想展示 fork 就把 .env 里的 GITHUB_REPO_INCLUDE_FORKS 设为 true。
    repos = [r for r in repos if not r["is_archived"]]
    if not settings.GITHUB_REPO_INCLUDE_FORKS:
        repos = [r for r in repos if not r["is_fork"]]

    wanted = _wanted_languages()
    if wanted:
        repos = [
            r for r in repos if (r["language"] or "").lower() in wanted
        ]

    # 排序：star 多的在前；star 相同按最近推送时间新的在前。
    # 用两次稳定排序实现（先按次要键，再按主要键），
    # 比写一个复合比较函数更不容易出错。
    repos.sort(key=lambda r: r["pushed_at"] or "", reverse=True)
    repos.sort(key=lambda r: r["stars"], reverse=True)

    _CACHE[key] = (now + CACHE_TTL, repos)
    logger.info("[GitHub] 拉取 %s 的仓库：%d 个", username, len(repos))
    return repos


def clear_cache() -> None:
    _CACHE.clear()
