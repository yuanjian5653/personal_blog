"""
GitHub OAuth 配置体检。

这个脚本回答一个问题：
    「我发给 GitHub 的 redirect_uri，到底是什么字符串？」

因为你遇到的那个报错

    Be careful!
    The redirect_uri ... is not associated with this application.

发生在**跳转到 GitHub 的那一步**，还没到你服务器 ——
纯粹是"我们发的 redirect_uri" 与 "OAuth App 里注册的回调地址" 字符串不一致。
所以只要把这两个字符串打出来逐字符比对就行。

它还会检查一个常见坑：
    .env 改了但**没重启后端** → 跑着的进程还是旧配置。
脚本会直接去问 127.0.0.1:8000 那个**正在运行**的接口，
而不是只读 .env 文件，所以能发现这种情况。

用法：
    cd blog-backend
    python scripts/check_oauth_config.py
    python scripts/check_oauth_config.py --url https://yuanjian.website
"""
from __future__ import annotations

import argparse
import socket
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import settings  # noqa: E402

OK = "  ✓ "
BAD = "  ✗ "
WARN = "  ⚠ "


def mask(value: str, keep: int = 4) -> str:
    if not value:
        return "(空)"
    if len(value) <= keep * 2:
        return "*" * len(value)
    return f"{value[:keep]}{'*' * (len(value) - keep * 2)}{value[-keep:]}"


def fetch_live_login_url(base: str) -> tuple[str | None, str | None]:
    """去问正在运行的后端：登录接口把 GitHub 跳去哪。

    返回 (location, error)。刻意不跟随重定向 —— 我们要的就是那个 302 的 Location。
    """
    import httpx

    url = f"{base.rstrip('/')}/api/comments/github/login"
    try:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            resp = client.get(url)
    except Exception as exc:
        return None, f"请求 {url} 失败：{type(exc).__name__}: {exc}"

    if resp.status_code not in (301, 302, 303, 307, 308):
        # 503 = 没配凭据；其它错误也把它们的内容带出来
        return None, f"{url} 返回 {resp.status_code}：{resp.text[:200]}"
    return resp.headers.get("location"), None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8000",
        help="后端地址（默认问本机正在跑的服务）",
    )
    args = parser.parse_args()

    print("=" * 72)
    print("GitHub OAuth 配置体检")
    print("=" * 72)

    # ---------------- 1. 配置 ----------------
    print("\n[1] .env 里读到的配置")
    print(f"  GITHUB_CLIENT_ID     : {settings.GITHUB_CLIENT_ID or '(空)'}")
    print(f"  GITHUB_CLIENT_SECRET : {mask(settings.GITHUB_CLIENT_SECRET)}")
    print(f"  BACKEND_URL          : {settings.BACKEND_URL!r}")
    print(f"  FRONTEND_URL         : {settings.FRONTEND_URL!r}")
    print(f"  COOKIE_SECURE        : {settings.COOKIE_SECURE}")
    print(f"  COOKIE_SAMESITE      : {settings.COOKIE_SAMESITE!r}")

    problems: list[str] = []

    if not settings.github_oauth_enabled:
        problems.append(
            "GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 没配全，登录接口会直接返回 503"
        )

    # ---------------- 2. 期望的回调地址 ----------------
    expected = settings.github_redirect_uri
    print("\n[2] 按 BACKEND_URL 拼出来的回调地址")
    print(f"  {expected}")

    if "localhost" in expected or "127.0.0.1" in expected:
        problems.append(
            "BACKEND_URL 还是本机地址，GitHub 一定会拒绝（它不可能回调到 localhost）。"
            "生产环境要写成 https://yuanjian.website"
        )
    if not expected.startswith("https://"):
        problems.append(
            f"回调地址不是 https（当前 {expected.split(':', 1)[0]}://...）。"
            "GitHub 允许 http，但你的生产站点是 https，两边必须一致"
        )
    if "//api" in expected.split("://", 1)[-1]:
        problems.append("BACKEND_URL 末尾多了斜杠，拼出了 //api")
    if expected != expected.strip():
        problems.append("回调地址首尾有空白字符")

    # ---------------- 3. 正在运行的进程实际发的地址 ----------------
    print(f"\n[3] 正在运行的后端实际发出的 redirect_uri（问 {args.url}）")
    location, err = fetch_live_login_url(args.url)

    live_redirect = None
    if err:
        print(f"{WARN}{err}")
        print("       （如果服务没起，可以只看 [2] 的期望值）")
    else:
        parsed = urlparse(location or "")
        params = parse_qs(parsed.query)
        live_redirect = (params.get("redirect_uri") or [None])[0]
        print(f"  授权页地址 : {parsed.netloc}{parsed.path}")
        print(f"  redirect_uri: {live_redirect!r}")
        print(f"  scope       : {(params.get('scope') or ['(无)'])[0]}")
        print(f"  state       : {'有' if params.get('state') else '没有（异常！）'}")

        if live_redirect and live_redirect != expected:
            problems.append(
                "**正在运行的进程**发出的回调地址与 .env 现在的内容不一致 → "
                "改了 .env 但没重启后端（systemctl restart blog-backend）"
            )

    # ---------------- 4. 服务器能不能连 GitHub ----------------
    print("\n[4] 服务器到 github.com 的出站连通性")
    for host, port in (("github.com", 443), ("api.github.com", 443)):
        try:
            with socket.create_connection((host, port), timeout=8):
                print(f"{OK}{host}:{port} 可连通")
        except Exception as exc:
            print(f"{BAD}{host}:{port} 连不上（{type(exc).__name__}）")
            problems.append(
                f"{host} 连不上：服务器无法完成 OAuth 换取 token，"
                "换网/加代理（GITHUB_PROXY）或换出口"
            )

    # ---------------- 5. 结论 ----------------
    print("\n" + "=" * 72)
    print("该往 GitHub 里填什么")
    print("=" * 72)
    print("  OAuth App → Authorization callback URL 必须是**这一整行**（不多不少）：")
    print()
    print(f"      {expected}")
    print()

    if problems:
        print("=" * 72)
        print(f"发现 {len(problems)} 个问题")
        print("=" * 72)
        for i, p in enumerate(problems, 1):
            print(f"  {i}. {p}")
        print()
        return 1

    print("=" * 72)
    print("本地配置看起来没问题")
    print("=" * 72)
    print("  如果浏览器仍报 redirect_uri 不匹配，那就是 GitHub 那一侧填的不一样。")
    print("  逐字符核对这几处最容易错的：")
    print("    · http / https")
    print("    · 有没有 www.")
    print("    · 末尾斜杠")
    print("    · 是 /api/comments/github/callback 而不是 /api/auth/callback")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
