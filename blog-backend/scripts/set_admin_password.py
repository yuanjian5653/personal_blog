"""
设置 / 重置管理员密码。

为什么需要这个脚本：
    原来除了 init_db.py 创建一个管理员之外，**没有任何改密码的途径** ——
    一旦怀疑密码泄漏，只能直接手改数据库。这个脚本补上这条路。

强度要求（弱密码是"被破解"最常见的原因）：
    · 至少 12 个字符
    · 不能是常见弱口令（admin / 123456 / password 等）
    · 不能和用户名相同、不能是纯数字

用法：
    # 交互输入（推荐，不会进 shell 历史）
    python scripts/set_admin_password.py

    # 指定用户名
    python scripts/set_admin_password.py --username admin

    # 查看当前账号（不改密码）
    python scripts/set_admin_password.py --list
"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.database import engine, init_db  # noqa: E402
from app.models import Admin  # noqa: E402
from app.services.security import hash_password  # noqa: E402

MIN_LEN = 12
WEAK = {
    "admin", "administrator", "password", "passw0rd", "123456", "12345678",
    "123456789", "1234567890", "qwerty", "qwerty123", "abc123", "iloveyou",
    "letmein", "welcome", "monkey", "dragon", "root", "toor", "test",
}


def check_strength(pw: str, username: str) -> str | None:
    """返回 None 表示通过，否则返回拒绝原因。"""
    if len(pw) < MIN_LEN:
        return f"太短，至少 {MIN_LEN} 个字符"
    low = pw.lower()
    if low in WEAK:
        return "这是常见弱口令，换一个"
    if low == username.lower():
        return "不能和用户名相同"
    if pw.isdigit():
        return "不能是纯数字"
    if len(set(pw)) <= 4:
        return "字符太重复了，换一个更难猜的"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default="admin")
    parser.add_argument("--list", action="store_true", help="只列出账号，不改密码")
    args = parser.parse_args()

    init_db()

    with Session(engine) as db:
        rows = db.exec(select(Admin)).all()
        admins = [r if isinstance(r, Admin) else r[0] for r in rows]
        admins = [a for a in admins if isinstance(a, Admin)]

        if args.list or not admins:
            print(f"  现有管理员 {len(admins)} 个：")
            for a in admins:
                locked = f"，锁定至 {a.locked_until}" if a.locked_until else ""
                print(f"    id={a.id}  username={a.username}  "
                      f"创建于 {a.created_at:%Y-%m-%d}{locked}")
            if not admins:
                print("  （没有管理员，请先跑 scripts/init_db.py）")
            return 0

        target = next((a for a in admins if a.username == args.username), None)
        if target is None:
            print(f"  找不到用户名为 {args.username!r} 的管理员")
            print("  现有：", ", ".join(a.username for a in admins))
            return 1

        pw1 = getpass.getpass(f"  为 {target.username} 设置新密码: ")
        reason = check_strength(pw1, target.username)
        if reason:
            print(f"  ✗ 密码不合格：{reason}")
            return 1

        pw2 = getpass.getpass("  再输入一次确认: ")
        if pw1 != pw2:
            print("  ✗ 两次输入不一致")
            return 1

        target.password_hash = hash_password(pw1)
        # 换密码同时解锁并清空失败计数，否则刚换完还是登录不了
        target.failed_attempts = 0
        target.locked_until = None
        db.add(target)
        db.commit()

    print("  ✓ 密码已更新，失败计数与锁定状态已清零")
    print("  提示：所有已登录的会话仍然有效，如需强制下线请删 admin_sessions 表相关行")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
