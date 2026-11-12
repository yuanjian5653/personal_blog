"""
后台登录诊断（在服务器上跑一遍就知道卡在哪）。

覆盖最常见的四种"其他设备登不上"：
  1. Cookie 安全标志与实际协议不匹配（http 访问 + Secure cookie = 浏览器不存）
  2. 账号被登录失败计数锁住
  3. 前端构建时的 API 地址是 localhost（别的设备会打自己的 127.0.0.1）
  4. 会话/账号状态异常

用法（在 blog-backend 目录）：
    python scripts/diagnose_login.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import engine  # noqa: E402

OK = "  [OK ]"
WARN = "  [警告]"
BAD = "  [问题]"


def main() -> int:
    problems = 0

    print("=" * 56)
    print(" 1. Cookie 与协议")
    print("=" * 56)
    print(f"   COOKIE_SECURE   = {settings.COOKIE_SECURE}")
    print(f"   COOKIE_SAMESITE = {settings.COOKIE_SAMESITE}")
    if settings.COOKIE_SECURE:
        print(
            WARN,
            "COOKIE_SECURE=true。如果你是用 http:// 访问后台，浏览器**不会保存**\n"
            "         这个 Cookie —— 表现就是「登录成功却马上退回登录页」。\n"
            "         新版会在检测到 http 时自动降级，但仍建议启用 HTTPS。",
        )
        problems += 1
    else:
        print(OK, "没有强制 Secure，http 访问也能正常保存 Cookie")

    if settings.COOKIE_SAMESITE.lower() == "none" and not settings.COOKIE_SECURE:
        print(BAD, "SameSite=None 必须配 Secure=true，否则浏览器会拒绝这个 Cookie")
        problems += 1

    print()
    print("=" * 56)
    print(" 2. 账号状态（有没有被锁）")
    print("=" * 56)
    with engine.connect() as c:
        rows = c.execute(
            text(
                "SELECT id, username, role, status, failed_attempts, locked_until "
                "FROM admin ORDER BY id"
            )
        ).fetchall()
    for r in rows:
        locked = r[5] is not None
        flag = BAD if (r[2] == "admin" and (r[3] != "active" or locked)) else OK
        print(
            f"   {flag} #{r[0]} {r[1]:<12} role={r[2]:<7} status={r[3]:<9} "
            f"失败次数={r[4]} 锁定到={r[5]}"
        )
        if r[2] == "admin" and locked:
            print(
                "        这里的 locked_until 不为空 = 被失败计数锁住了。\n"
                "        解锁：UPDATE admin SET failed_attempts=0, locked_until=NULL "
                f"WHERE id={r[0]};"
            )
            problems += 1
        if r[2] == "admin" and r[3] != "active":
            print("        管理员状态不是 active，登录会被 403 拒绝。")
            problems += 1

    print()
    print("=" * 56)
    print(" 3. 前端构建时的 API 地址")
    print("=" * 56)
    # Next.js 的 env 优先级是从上到下**先找到的胜出**，
    # 所以只看第一个存在且定义了 NEXT_PUBLIC_API_BASE_URL 的文件 ——
    # 上面 .env.local 写 localhost 不影响生产构建，不能单独报警。
    fe = Path(__file__).resolve().parent.parent.parent / "blog-frontend"
    effective = None
    effective_from = None
    for name in (".env.production.local", ".env.local", ".env.production", ".env"):
        p = fe / name
        if not p.exists():
            print(f"   {name}: (不存在)")
            continue
        found = None
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            if "NEXT_PUBLIC_API_BASE_URL" in line and not line.strip().startswith("#"):
                found = line.split("=", 1)[1].strip()
        print(f"   {name}: {found if found else '(未设置该变量)'}")
        if found is not None and effective is None:
            effective = found
            effective_from = name

    if effective is None:
        print(
            WARN,
            "四个 env 文件里都没有 NEXT_PUBLIC_API_BASE_URL，\n"
            "         前端会退回默认值 http://localhost:8000 —— 别的设备登不上。",
        )
        problems += 1
    elif "localhost" in effective or "127.0.0.1" in effective:
        print(
            BAD,
            f"生产构建实际用的是 {effective_from} 里的「{effective}」——\n"
            "         别的设备打开页面后，API 请求会打到**那台设备自己**的\n"
            "         127.0.0.1，当然登录不了。生产应设成 /（同源）或后端公网域名，\n"
            "         然后重新构建前端。",
        )
        problems += 1
    else:
        print(OK, f"生产构建实际用 {effective_from} 的「{effective}」，别的设备能访问到后端")

    print()
    print("=" * 56)
    print(" 4. 最近一次成功登录")
    print("=" * 56)
    with engine.connect() as c:
        n = c.execute(
            text("SELECT COUNT(*) FROM admin_sessions WHERE expires_at > NOW()")
        ).scalar()
    print(f"   当前有效会话数：{n}")
    if n == 0:
        print(WARN, "一个有效会话都没有；如果刚登录过就说明 Cookie 没存下来")

    print()
    if problems:
        print(f"发现 {problems} 处值得检查的地方，见上面的 [问题] / [警告]。")
    else:
        print("没有发现明显问题。把浏览器 Network 里 /api/auth/login 的")
        print("响应头和 Status 截图发我，再往下查。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
