"""验证 /api/site-config/stats 统计结果与数据库实际行数一致。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.config import settings  # noqa: E402
from app.routers.site_config import read_stats  # noqa: E402

engine = create_engine(settings.DATABASE_URL, echo=False)

# 接口返回
with Session(engine) as db:
    stats = read_stats(db)

print("接口返回:")
for k, v in stats.model_dump().items():
    print(f"   {k:10s} {v}")

# 直接用 SQL 核对
checks = {
    "articles": "SELECT COUNT(*) FROM articles WHERE status='published'",
    "essays": "SELECT COUNT(*) FROM essays",
    "photos": "SELECT COUNT(*) FROM photos",
    "albums": "SELECT COUNT(*) FROM albums",
    "songs": "SELECT COUNT(*) FROM songs",
}
print()
print("SQL 直接核对:")
ok = True
with engine.connect() as c:
    for key, sql in checks.items():
        real = c.execute(text(sql)).scalar()
        got = getattr(stats, key)
        match = real == got
        if not match:
            ok = False
        print(f"   {key:10s} 接口={got:3d}  SQL={real:3d}  {'OK' if match else '不一致!'}")

print()
if ok:
    print("[通过] 统计接口与数据库实际数据完全一致")
    raise SystemExit(0)
print("[失败] 有不一致项")
raise SystemExit(1)
