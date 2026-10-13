"""
诊断 GitHub OAuth 需要访问的两个地址是否可达。

背景：GitHub 授权码换 token 访问 https://github.com/login/oauth/access_token，
拿用户信息访问 https://api.github.com/user。两者是**不同主机**，
被防火墙/代理拦截的情况也常常不同 —— 典型的"api 通、github.com 不通"。

GitHub 官方针对 https://github.com 被拦的情况，建议改用 HTTP 端点：
    http://github.com/login/oauth/access_token
（该端点会自动跳转到 HTTPS，但在被拦截的网络里通常能走通。）

用法：
    python scripts/diagnose_github_net.py
"""
import os
import socket
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402

TARGETS = [
    ("https://github.com/login/oauth/access_token", "换 token（HTTPS）"),
    ("http://github.com/login/oauth/access_token", "换 token（HTTP 备用）"),
    ("https://api.github.com/user", "取用户信息（HTTPS）"),
]


def dns(host: str) -> str:
    try:
        return socket.gethostbyname(host)
    except Exception as e:
        return f"解析失败: {e}"


def tcp(host: str, port: int, timeout: float = 8.0) -> str:
    t0 = time.time()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return f"通（{time.time() - t0:.2f}s）"
    except Exception as e:
        return f"不通（{type(e).__name__}: {e}）"


def port_open(host: str, port: int, timeout: float = 0.6) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def http_probe(url: str, timeout: float = 12.0) -> tuple[str, bool]:
    """探测 URL 是否**真正可用**（返回文本 + 是否可用）。

    ⚠️ 关键：只看"HTTP 有响应"会被 HTTP→HTTPS 的 301 骗到。
    http://github.com/... 会 301 到 https://github.com/...，
    而真正被拦的就是 https://github.com —— 跟随重定向后依然超时。
    所以要判断"跟随重定向后是否成功"，而不是首跳状态码。
    """
    t0 = time.time()
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as c:
            r = c.post(url, data={})
        # 能拿到任何 status 都说明握手与响应都完成了
        return f"可用 HTTP {r.status_code}（{time.time() - t0:.2f}s）", True
    except httpx.ReadTimeout:
        return f"不可用 读取超时（{time.time() - t0:.2f}s）", False
    except httpx.ConnectTimeout:
        return f"不可用 连接超时（{time.time() - t0:.2f}s）", False
    except Exception as e:
        return f"不可用 {type(e).__name__}（{time.time() - t0:.2f}s）", False


def main() -> int:
    print("=" * 62)
    print(" GitHub OAuth 网络诊断")
    print("=" * 62)

    print("\n--- 代理相关环境变量 ---")
    found = False
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
              "http_proxy", "https_proxy", "all_proxy", "no_proxy"):
        v = os.environ.get(k)
        if v:
            print(f"  {k} = {v}")
            found = True
    if not found:
        print("  （未设置任何代理环境变量 —— 若你需要代理才能上 GitHub，")
        print("     这就是后端连不上的原因：httpx 不会读取 Windows 系统代理设置）")

    print("\n--- DNS ---")
    for host in ("github.com", "api.github.com"):
        print(f"  {host:18s} -> {dns(host)}")

    print("\n--- TCP 连接 ---")
    print(f"  github.com:443     {tcp('github.com', 443)}")
    print(f"  github.com:80      {tcp('github.com', 80)}")
    print(f"  api.github.com:443 {tcp('api.github.com', 443)}")

    print("\n--- HTTP 探测（跟随重定向后的真实结果）---")
    results = {}
    for url, label in TARGETS:
        msg, ok = http_probe(url)
        results[label] = ok
        print(f"  {label:22s} {msg}")

    # 关键补充：POST 到 token 端点，看它到底有没有被 GitHub 的 OAuth 处理。
    # 用伪造但格式合法的凭据：
    #   · 正常情况 GitHub 回 200 {"error":"incorrect_client_credentials"}
    #   · 若回 404 {"error":"Not Found"}，说明该路径没被正确处理
    #     （常见于本机 MITM 代理只放行网页、不放行 OAuth 端点）
    print("\n--- token 端点 POST 行为（用伪造凭据）---")
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    for label, kwargs in ([(f"经代理 {proxy}", {"proxy": proxy})] if proxy else []) + [("直连", {})]:
        try:
            with httpx.Client(timeout=20, verify=False, follow_redirects=True, **kwargs) as c:
                r = c.post(
                    "https://github.com/login/oauth/access_token",
                    data={
                        "client_id": "0" * 20,
                        "client_secret": "0" * 40,
                        "code": "0" * 20,
                    },
                    headers={"Accept": "application/json", "User-Agent": "personal-blog"},
                )
            body = " ".join(r.text.split())[:110]
            print(f"  [{label}] HTTP {r.status_code}  {body!r}")
            if r.status_code == 200 and "incorrect_client_credentials" in r.text:
                print("        → 端点正常处理了 OAuth 请求（凭据是我们伪造的，所以报错是对的）")
            elif r.status_code == 404:
                print("        → 404！该路径没有被 GitHub 的 OAuth 处理。")
                print("          如果这也发生在经代理的那一行，说明你的代理/加速器")
                print("          没有正确放行 /login/oauth/access_token。")
        except Exception as e:
            print(f"  [{label}] {type(e).__name__}: {e}")

    print("\n--- 本机常见代理端口 ---")
    opened = []
    for port, name in [(7890, "Clash"), (7891, "Clash(socks)"), (1080, "通用 socks"),
                       (10808, "v2rayN"), (10809, "v2rayN(http)"), (8080, "通用"),
                       (8888, "通用"), (1087, "通用")]:
        if port_open("127.0.0.1", port):
            print(f"  [开] 127.0.0.1:{port}  ({name})")
            opened.append((port, name))
    if not opened:
        print("  未发现本机常见代理端口 —— 你的代理可能在别的机器/端口上")

    print("\n" + "=" * 62)
    https_ok = results.get("换 token（HTTPS）", False)
    http_ok = results.get("换 token（HTTP 备用）", False)
    api_ok = results.get("取用户信息（HTTPS）", False)

    if https_ok and api_ok:
        print(" 结论：网络正常，两个地址都可用。此时若登录仍失败，")
        print("       看后端控制台里 [评论] 那几行日志的具体报错。")
    else:
        print(" 结论：后端访问 GitHub 受阻。按下面顺序处理：")
        if not https_ok and http_ok:
            print("  · HTTPS 不通但 HTTP 通 → 在 .env 里设")
            print("        GITHUB_OAUTH_TOKEN_URL=http://github.com/login/oauth/access_token")
        elif not http_ok:
            print("  · 连 HTTP 备用端点也不通 → **改用 HTTP 端点没用**，")
            print("    因为 http://github.com 只是 301 跳到 https://github.com，")
            print("    而被拦的正是 https://github.com。")
            print("  · 最可能的原因：浏览器走了代理（系统代理/PAC/插件），")
            print("    而 Python 的 httpx **不会**读取 Windows 系统代理设置。")
            print("    解决：找到代理的监听地址和端口，然后在启动后端前设置环境变量：")
            print("        set HTTPS_PROXY=http://127.0.0.1:你的端口")
            print("        set HTTP_PROXY=http://127.0.0.1:你的端口")
            print("        set NO_PROXY=localhost,127.0.0.1,::1")
            print("    （Clash 常见 7890，v2rayN 常见 10809；上面已列出本机监听端口）")
            print("  · 也可以在代理软件里开启「系统代理 / TUN 模式」，")
            print("    让所有程序（含 Python）都走代理。")
        if not api_ok:
            print("  · api.github.com 也不通，同样可用 GITHUB_API_USER_URL 覆盖。")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
