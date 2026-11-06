"""
邮件推送链路诊断（阿里云 DirectMail · SMTP）

为什么需要这个脚本：
    配 SMTP 最容易踩的坑不是网络，而是「发信地址」和 `MAIL_FROM` 不一致。
    阿里云创建发信地址时如果**账号留空**，它会拿域名当账号，于是真实地址是
        mail.yuanjian.website@mail.yuanjian.website
    而 SMTP 的用户名**必须与发信地址完全一致**，填成 noreply@... 就会得到
        SMTPAuthenticationError: (535, b'Authentication failure')
    只看报错完全看不出是"地址填错了"，所以这里把每一步都摊开打印。

用法：
    cd blog-backend
    python scripts/diagnose_mail.py
    python scripts/diagnose_mail.py --to you@example.com    # 顺带发一封测试信

注意：用后端自己的解释器（venv），或直接 python3 也行 ——
脚本在拿不到 app.config 时会自己解析 .env，不依赖 python-dotenv。
"""
from __future__ import annotations

import argparse
import pathlib
import smtplib
import socket
import ssl
import sys

BACKEND = pathlib.Path(__file__).resolve().parent.parent


# ------------------------------------------------------------
# 配置读取：优先用 app.config（能反映真实运行配置），
# 失败则手工解析 .env（这样用系统 python3 也能查）
# ------------------------------------------------------------
class Cfg:
    def __init__(self) -> None:
        self.source = ""
        self.host = "smtpdm.aliyun.com"
        self.port = 465
        self.mail_from = ""
        self.password = ""
        self.from_name = ""
        self.reply_to = ""
        self.site_url = ""
        self._load()

    def _load(self) -> None:
        try:
            sys.path.insert(0, str(BACKEND))
            from app.config import settings  # type: ignore

            self.source = "app.config（后端真实配置）"
            self.host = settings.MAIL_HOST
            self.port = settings.MAIL_PORT
            self.mail_from = settings.MAIL_FROM
            self.password = settings.MAIL_PASSWORD
            self.from_name = settings.MAIL_FROM_NAME
            self.reply_to = settings.MAIL_REPLY_TO
            self.site_url = settings.SITE_URL
            return
        except Exception:
            pass

        env_file = BACKEND / ".env"
        self.source = f"手工解析 {env_file}（未使用 app.config）"
        raw: dict[str, str] = {}
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, _, v = line.partition("=")
                raw[k.strip()] = v

        def val(key: str) -> str:
            v = raw.get(key, "")
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            return v

        self.host = val("MAIL_HOST") or self.host
        try:
            self.port = int(val("MAIL_PORT") or "465")
        except ValueError:
            self.port = 465
        self.mail_from = val("MAIL_FROM")
        self.password = val("MAIL_PASSWORD")
        self.from_name = val("MAIL_FROM_NAME")
        self.reply_to = val("MAIL_REPLY_TO")
        self.site_url = val("SITE_URL")

    @property
    def enabled(self) -> bool:
        return bool(self.mail_from and self.password)


def masked(pw: str) -> str:
    if not pw:
        return "(空)"
    if len(pw) <= 4:
        return "*" * len(pw)
    return "%s%s%s" % (pw[:2], "*" * (len(pw) - 4), pw[-2:])


def main() -> int:
    parser = argparse.ArgumentParser(description="诊断邮件推送（阿里云 SMTP）")
    parser.add_argument("--to", help="收件人；给了就顺带发一封测试信")
    args = parser.parse_args()

    c = Cfg()

    print("=" * 68)
    print("邮件推送链路诊断")
    print("=" * 68)
    print("[0] 配置来源: %s" % c.source)

    print("\n[1] 配置检查")
    print("  MAIL_FROM   : %r" % c.mail_from)
    print("  MAIL_HOST   : %r  PORT: %s" % (c.host, c.port))
    print("  MAIL_FROM_NAME: %r" % c.from_name)
    print("  MAIL_REPLY_TO : %r" % c.reply_to)
    print("  SITE_URL      : %r" % c.site_url)
    pw_ok = True
    if c.password:
        print(
            "  MAIL_PASSWORD : len=%d  %s  ascii=%s  含空白=%s  含引号=%s"
            % (
                len(c.password),
                masked(c.password),
                c.password.isascii(),
                any(ch.isspace() for ch in c.password),
                ('"' in c.password) or ("'" in c.password),
            )
        )
        if not c.password.isascii():
            print("  ✗ 密码含非 ASCII 字符 —— 很可能把占位说明文字当密码贴进去了")
            pw_ok = False
        if any(ch.isspace() for ch in c.password):
            print("  ✗ 密码含空白字符 —— .env 行尾可能有空格或 CR")
            pw_ok = False
    else:
        print("  MAIL_PASSWORD : (空)")
        pw_ok = False

    if not c.enabled:
        print("\n>>> MAIL_FROM 或 MAIL_PASSWORD 为空：后端不会发信（订阅仍会记录邮箱）")
        return 1

    # 发信地址的形态提示：阿里云「账号留空」时会变成 域名@域名
    if "@" in c.mail_from:
        account, _, domain = c.mail_from.partition("@")
        if account == domain:
            print(
                "\n  ⚠ 发信地址形如「域名@域名」(%s)。这不是错误，"
                "\n    说明创建发信地址时【账号】留空了。SMTP 用户名必须原样使用它。" % c.mail_from
            )
        else:
            print("\n  ✓ 发信地址账号部分 = %r，域名部分 = %r" % (account, domain))
            print("    （必须与控制台「发信地址」列表里显示的那条完全一致）")

    print("\n[2] DNS 解析")
    try:
        ip = socket.gethostbyname(c.host)
        print("  %s -> %s" % (c.host, ip))
    except Exception as exc:
        print("  ✗ 解析失败: %s" % exc)
        return 1

    print("\n[3] TCP 连接")
    try:
        with socket.create_connection((c.host, c.port), timeout=10):
            pass
        print("  连通 %s:%s" % (c.host, c.port))
    except Exception as exc:
        print("  ✗ 连接失败: %s" % exc)
        print("    可能原因：出站端口被安全组/运营商拦截；端口填错（465=SSL）")
        return 1

    print("\n[4] TLS + 登录（关键一步）")
    smtp = None
    try:
        context = ssl.create_default_context()
        if c.port == 465:
            smtp = smtplib.SMTP_SSL(c.host, c.port, timeout=20, context=context)
        else:
            smtp = smtplib.SMTP(c.host, c.port, timeout=20)
            smtp.starttls(context=context)
        code, msg = smtp.login(c.mail_from, c.password)
        print("  ✓ 登录成功: %s %s" % (code, msg))
    except smtplib.SMTPAuthenticationError as exc:
        print("  ✗ 认证失败: %s %s" % (exc.smtp_code, exc.smtp_error))
        print("    说明用户名或密码不对。按顺序检查：")
        print("      1) 控制台「发信地址」里那条地址，是否与 MAIL_FROM 逐字符一致")
        print("         （账号留空时会变成 域名@域名，很容易以为是自己填的那个）")
        print("      2) 该发信地址是否点过「设置 SMTP 密码」，密码是否后来又重设过")
        print("      3) 发信地址状态是否为「正常」（不是待验证/已失效）")
        return 1
    except Exception as exc:
        print("  ✗ 失败: %s %s" % (type(exc).__name__, exc))
        return 1
    finally:
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:
                pass

    if pw_ok is False:
        print("\n[5] 结论：配置与登录都通过，但密码里有可疑字符（见 [1]）——建议重设一个纯字母数字密码")
        return 0

    if not args.to:
        print("\n[5] 结论：链路正常。加 --to you@example.com 可以真发一封测试信")
        return 0

    print("\n[5] 发送测试信 -> %s" % args.to)
    try:
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["From"] = c.mail_from if not c.from_name else "%s <%s>" % (c.from_name, c.mail_from)
        msg["To"] = args.to
        msg["Subject"] = "测试：邮件推送链路"
        if c.reply_to:
            msg["Reply-To"] = c.reply_to
        msg.set_content("如果你在收件箱看到这封邮件，说明链路是通的。")
        msg.add_alternative(
            "<p>如果你在 <b>收件箱</b> 看到这封邮件，说明链路是通的。</p>",
            subtype="html",
        )

        ctx = ssl.create_default_context()
        if c.port == 465:
            with smtplib.SMTP_SSL(c.host, c.port, timeout=20, context=ctx) as s:
                s.login(c.mail_from, c.password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(c.host, c.port, timeout=20) as s:
                s.starttls(context=ctx)
                s.login(c.mail_from, c.password)
                s.send_message(msg)
        print("  ✓ 已提交给服务器。去收件箱看看（也查一下垃圾邮件箱）")
        return 0
    except Exception as exc:
        print("  ✗ 发送失败: %s %s" % (type(exc).__name__, exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
