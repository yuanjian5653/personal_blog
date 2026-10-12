"""
一键初始化：为刚克隆项目的用户准备好可运行的数据库。

做四件事：
    1. 检查 .env，不存在则从 .env.example 生成并提示填写
    2. 检查 MySQL 是否可连（连不上就给出明确提示，而不是让应用启动时崩）
    3. 创建数据库（若不存在）+ 建表
    4. 创建管理员账号（否则后台永远登不进去）

用法：
    # 交互式（会提示输入管理员用户名和密码）
    python scripts/init_db.py

    # 无人值守
    python scripts/init_db.py --admin-user admin --admin-password 'your-pass'

    # 只建库建表，不建管理员
    python scripts/init_db.py --skip-admin

    # 看看会做什么，不实际改动
    python scripts/init_db.py --dry-run
"""
import argparse
import getpass
import logging
import shutil
import sys
from contextlib import contextmanager
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import create_engine, inspect, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlmodel import Session, select  # noqa: E402


def step(n: int, msg: str) -> None:
    print(f"\n[{n}/4] {msg}")


def make_engine(url):
    """本脚本专用引擎：始终关掉 SQL 回显（初始化阶段不需要看 SQL）。"""
    return create_engine(url, pool_pre_ping=True, echo=False)


@contextmanager
def quiet_sql(*engines):
    """临时关掉 SQLAlchemy 的 SQL 回显。

    app.database 里的 engine 是按 settings.DEBUG 建的（你 .env 里是 True），
    它会把每条 SQL 都打到 stdout，把这里的引导提示淹没。等应用真正跑起来时
    仍然是 DEBUG 行为，这里只是初始化期间安静一下。
    """
    log = logging.getLogger("sqlalchemy.engine")
    old_level = log.level
    old_echo = [(e, e.echo) for e in engines]
    log.setLevel(logging.WARNING)
    for e in engines:
        e.echo = False
    try:
        yield
    finally:
        log.setLevel(old_level)
        for e, val in old_echo:
            e.echo = val


def ensure_env(dry_run: bool) -> bool:
    """确保 .env 存在。返回 True 表示可以继续。"""
    env = BACKEND_DIR / ".env"
    example = BACKEND_DIR / ".env.example"

    if env.exists():
        print(f"   .env 已存在: {env}")
        return True

    if not example.exists():
        print(f"   [错误] 找不到 {example}，无法生成 .env")
        return False

    if dry_run:
        print(f"   [dry-run] 将从 .env.example 生成 {env}")
        return False

    shutil.copyfile(example, env)
    print(f"   已生成 {env}")
    print("   ⚠ 请打开它，把 DATABASE_URL 里的「用户名:密码」改成你自己的 MySQL 账号，")
    print("     然后重新运行本脚本。")
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-user", help="管理员用户名")
    ap.add_argument("--admin-password", help="管理员密码")
    ap.add_argument("--skip-admin", action="store_true", help="不创建管理员")
    ap.add_argument("--dry-run", action="store_true", help="只预览")
    args = ap.parse_args()

    print("=" * 60)
    print("  个人博客 —— 数据库初始化")
    print("=" * 60)

    # ---------- 1. .env ----------
    step(1, "检查配置文件 .env")
    if not ensure_env(args.dry_run):
        return 0 if args.dry_run else 1

    # 到这一步才能 import app.config（它需要 .env 已就绪）
    # 关掉 SQLAlchemy 的 INFO 日志，避免 DEBUG=True 时刷屏
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    from app.config import settings
    from app.database import engine as app_engine, init_db
    from app.models import Admin
    from app.services.security import hash_password

    url = make_url(settings.DATABASE_URL)
    if not url.drivername.startswith("mysql"):
        print(f"   [错误] DATABASE_URL 不是 MySQL 连接串：{url.drivername}")
        print("          本项目当前只支持 MySQL，格式：")
        print("          mysql+pymysql://用户名:密码@主机:3306/数据库名?charset=utf8mb4")
        return 1

    host = url.host or "localhost"
    port = url.port or 3306
    dbname = url.database
    print(f"   目标数据库: {dbname} @ {host}:{port}")
    print(f"   账号: {url.username}")

    if not dbname:
        print("   [错误] DATABASE_URL 里没写数据库名")
        return 1

    if args.dry_run:
        print("\n[dry-run] 到此为止，未做任何改动。")
        return 0

    # ---------- 2. 连通性 ----------
    step(2, "检查 MySQL 是否可连接")
    try:
        probe = make_engine(settings.DATABASE_URL)
        with probe.connect() as c:
            ver = c.execute(text("SELECT VERSION()")).scalar()
        print(f"   连接成功，MySQL 版本 {ver}")
    except Exception as e:
        print(f"   [失败] 连接不上 MySQL：{type(e).__name__}")
        print(f"          {str(e)[:300]}")
        print("\n   请依次检查：")
        print("     1. MySQL 服务是否已启动")
        print("        Windows: 服务管理器里找 MySQL80，或执行")
        print("                 net start MySQL80")
        print(f"     2. {host}:{port} 是否能通")
        print("     3. .env 里的用户名/密码是否正确")
        print(f"     4. 账号是否已被授权访问 {host}")
        return 1

    # ---------- 3. 建库 + 建表 ----------
    step(3, "创建数据库与数据表")
    server_url = url.set(database=None)
    server_engine = make_engine(server_url)

    with server_engine.connect() as c:
        exists = c.execute(
            text("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA "
                 "WHERE SCHEMA_NAME = :n"),
            {"n": dbname},
        ).scalar()

    if exists:
        print(f"   数据库 `{dbname}` 已存在，跳过创建")
    else:
        # 库名不能用绑定参数，这里做白名单校验防注入
        if not dbname.replace("_", "").isalnum():
            print(f"   [错误] 库名含非法字符: {dbname}")
            return 1
        with server_engine.connect() as c:
            c.execute(text(
                f"CREATE DATABASE `{dbname}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            ))
        print(f"   已创建数据库 `{dbname}`（utf8mb4）")

    with quiet_sql(app_engine):
        init_db()
        tables = inspect(app_engine).get_table_names()
    print(f"   数据表就绪，共 {len(tables)} 张：{', '.join(sorted(tables))}")
    # ---------- 4. 管理员 ----------
    step(4, "创建管理员账号")
    if args.skip_admin:
        print("   已跳过（--skip-admin）")
        return 0

    engine = make_engine(settings.DATABASE_URL)

    username = args.admin_user
    password = args.admin_password
    if not username or not password:
        print("   需要创建管理员才能登录后台 (http://localhost:3000/admin/login)")
        if not username:
            username = input("   管理员用户名 [admin]: ").strip() or "admin"
        if not password:
            while True:
                password = getpass.getpass("   管理员密码（输入时不显示）: ")
                if len(password) < 6:
                    print("   密码至少 6 位，请重新输入")
                    continue
                confirm = getpass.getpass("   再输入一次确认: ")
                if password != confirm:
                    print("   两次输入不一致，请重新输入")
                    continue
                break

    with Session(engine) as db:
        existing = db.exec(select(Admin).where(Admin.username == username)).first()
        if existing:
            print(f"   管理员 `{username}` 已存在，跳过创建")
            return 0
        db.add(Admin(username=username, password_hash=hash_password(password)))
        db.commit()

    print(f"   已创建管理员 `{username}`（密码为 bcrypt 哈希存储）")
    print("\n" + "=" * 60)
    print("  初始化完成，可以启动项目了！")
    print("=" * 60)
    print("  后端接口文档: http://localhost:8000/docs")
    print("  前台首页:     http://localhost:3000")
    print(f"  后台登录:     http://localhost:3000/admin/login  ({username})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
