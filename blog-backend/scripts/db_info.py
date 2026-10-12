"""查看 MySQL 里实际存了什么（只读，不改任何数据）。"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, inspect, text  # noqa: E402

from app.config import settings  # noqa: E402

safe = re.sub(r"://([^:]+):[^@]+@", r"://\1:***@", settings.DATABASE_URL)
print("连接串（密码已隐去）:")
print("   ", safe)
print()

engine = create_engine(settings.DATABASE_URL)

with engine.connect() as c:
    print("=== MySQL 实例里的所有数据库 ===")
    dbs = [r[0] for r in c.execute(text("SHOW DATABASES"))]
    for name in dbs:
        mark = "   <== 本项目在用" if name == "personal_blog" else ""
        print(f"   {name}{mark}")

    print()
    print("=== 服务器信息 ===")
    ver = c.execute(text("SELECT VERSION()")).scalar()
    print(f"   版本: {ver}")
    size = c.execute(
        text(
            "SELECT ROUND(SUM(data_length+index_length)/1024/1024, 2) "
            "FROM information_schema.TABLES WHERE table_schema='personal_blog'"
        )
    ).scalar()
    print(f"   personal_blog 占用空间: {size} MB")

insp = inspect(engine)
tables = insp.get_table_names()

print()
print("=== personal_blog 库的表与行数 ===")
total = 0
with engine.connect() as c:
    for t in sorted(tables):
        n = c.execute(text(f"SELECT COUNT(*) FROM `{t}`")).scalar()
        total += n
        print(f"   {t:<20} {n:>6} 行")
    print(f"   {'合计':<18} {total:>6} 行")

print()
print("=== 表结构来源（SQLModel 模型）===")
for t in sorted(tables):
    cols = [col["name"] for col in insp.get_columns(t)]
    print(f"   {t:<20} 字段: {', '.join(cols[:8])}{' ...' if len(cols) > 8 else ''}")
