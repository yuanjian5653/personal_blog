"""
GitHub OAuth 客户端

只做三件事：换 token、取用户信息、验证 token 是否还有效。
不引入 authlib —— GitHub 的这套流程就是两次 HTTP 请求，用已有的 httpx 手写
反而更直观，也少一个依赖。

OAuth 流程（Authorization Code）：
1. 前端打开 /api/comments/github/login
2. 后端 302 到 https://github.com/login/oauth/authorize?client_id=...&state=...
3. 用户授权后 GitHub 回跳 /api/comments/github/callback?code=...&state=...
4. 后端用 code 换 access_token，再拿 token 取用户信息，建/更新 commenter
5. 写登录 Cookie 并 302 回前端
"""
import logging
import ssl
from functools import lru_cache

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"

# 注意：TOKEN_URL / USER_URL 默认值放在 app.config 里，可用 .env 覆盖。
def token_url() -> str:
    return settings.GITHUB_OAUTH_TOKEN_URL


def user_url() -> str:
    return settings.GITHUB_API_USER_URL


# GitHub 要求带 UA，否则可能拒绝
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "personal-blog",
}


@lru_cache(maxsize=1)
def _ssl_context() -> ssl.SSLContext:
    """certifi + 操作系统证书存储。

    为什么需要：如果你的 GitHub 访问要经过本机加速器/代理
    （如 Watt Toolkit / SteamTools），它会做 HTTPS 中间人，
    用**自己的根证书**签发 github.com 的证书。浏览器信任它
    （因为该根证书装在系统存储里），但 Python 默认只用 certifi，
    于是报 CERTIFICATE_VERIFY_FAILED。

    这里把系统 Root/CA 存储里的证书追加进来 —— 等同于"信任
    操作系统信任的证书"，因此**不需要**关闭证书校验。
    """
    ctx = ssl.create_default_context()
    if not hasattr(ssl, "enum_certificates"):
        # 非 Windows（Linux/macOS）没有这个 API，直接用默认上下文
        return ctx

    loaded = 0
    for store in ("ROOT", "CA"):
        try:
            for cert_der, _encoding, trust in ssl.enum_certificates(store):
                if not trust:
                    continue
                try:
                    ctx.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert(cert_der))
                    loaded += 1
                except Exception:
                    # 个别证书格式不被接受，跳过即可
                    pass
        except Exception:
            pass

    logger.info("[评论] 已从系统证书存储额外加载 %d 张证书（用于代理场景）", loaded)
    return ctx


def _client(**kwargs) -> httpx.AsyncClient:
    """统一的 httpx 客户端。

    环境相关的两个坑：

    1. **代理**：httpx 会自动读取 HTTPS_PROXY / HTTP_PROXY 环境变量，
       但**不会**读取 Windows 的系统代理或 PAC 脚本。
       如果你靠本机 PAC（例如 Watt Toolkit/SteamTools 在
       http://127.0.0.1:26561/pac 提供的代理）才能上 GitHub，
       就必须显式指定，二选一：
         · 设 GITHUB_PROXY=http://127.0.0.1:26561（推荐，只影响 GitHub 请求）
         · 或设环境变量 HTTPS_PROXY，并配 NO_PROXY=localhost,127.0.0.1
           （不配 NO_PROXY 会把本机请求也塞进代理）
    2. **证书**：见 _ssl_context()，已自动兼容代理的中间人证书。
    """
    verify = _ssl_context()
    return httpx.AsyncClient(
        timeout=settings.GITHUB_TIMEOUT,
        verify=verify,
        proxy=settings.GITHUB_PROXY,
        **kwargs,
    )


# GitHub 要求带 UA，否则可能拒绝
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "personal-blog",
}


class GitHubOAuthError(Exception):
    """OAuth 过程中的可预期错误（凭据错误、code 失效等）"""


async def exchange_code_for_token(
    client_id: str, client_secret: str, code: str, redirect_uri: str
) -> str:
    """用授权码换 access_token"""
    async with _client(headers=HEADERS) as client:
        resp = await client.post(
            token_url(),
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )

    if resp.status_code != 200:
        raise GitHubOAuthError(f"换取 token 失败（HTTP {resp.status_code}）")

    try:
        data = resp.json()
    except ValueError:
        raise GitHubOAuthError("换取 token 时返回了非 JSON 内容")

    # GitHub 出错时会在 200 里返回 {"error": "..."}
    if data.get("error"):
        raw = f"{data.get('error')}: {data.get('error_description', '')}".strip()
        raise GitHubOAuthError(_explain_token_error(raw, redirect_uri))

    token = data.get("access_token")
    if not token:
        raise GitHubOAuthError("响应里没有 access_token")

    return token


def _explain_token_error(raw: str, redirect_uri: str) -> str:
    """把 GitHub 的报错翻译成"该去改哪里"。

    最常见的两种失败：
    - redirect_uri_mismatch：OAuth App 里填的回调地址与实际请求的不一致
    - incorrect_client_credentials：把 GitHub App 的凭据当成 OAuth App 用了
    """
    low = raw.lower()

    if "redirect_uri" in low or "redirect uri" in low:
        return (
            f"回调地址不匹配（{raw}）。"
            f"请到 GitHub → Settings → Developer settings → OAuth Apps → 你的应用，"
            f"把 Authorization callback URL 改成：{redirect_uri}"
        )

    if "incorrect_client_credentials" in low or "client_id" in low:
        return (
            f"client_id / client_secret 不正确（{raw}）。"
            "请确认这对凭据来自 OAuth App（不是 GitHub App），并已完整复制 Secret。"
        )

    if "bad_verification_code" in low or "code" in low:
        return (
            f"授权码无效或已过期（{raw}）。"
            "授权码只能用一次且有效期很短，请重新点一次登录。"
        )

    return raw


async def fetch_user(access_token: str) -> dict:
    """用 access_token 取用户信息"""
    async with _client(
        headers={**HEADERS, "Authorization": f"Bearer {access_token}"}
    ) as client:
        resp = await client.get(user_url())

    if resp.status_code != 200:
        raise GitHubOAuthError(f"获取用户信息失败（HTTP {resp.status_code}）")

    try:
        data = resp.json()
    except ValueError:
        raise GitHubOAuthError("获取用户信息时返回了非 JSON 内容")

    if not data.get("id"):
        raise GitHubOAuthError("用户信息里没有 id")

    return data


def build_authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    """拼授权跳转地址"""
    params = httpx.QueryParams(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "read:user",  # 只需要读公开资料，不要 repo 权限
            "state": state,
            "allow_signup": "true",
        }
    )
    return f"{AUTHORIZE_URL}?{params}"
