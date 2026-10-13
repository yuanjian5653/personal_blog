"""列出评论相关路由，确认全部注册且方法正确。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402

spec = app.openapi()
rows = []
for path, ops in spec.get("paths", {}).items():
    if "comment" in path:
        for method in ops:
            rows.append((method.upper(), path))

print("=== 评论相关接口 ===")
for m, p in sorted(rows, key=lambda x: (x[1], x[0])):
    print(f"  {m:6s} {p}")
print(f"\n共 {len(rows)} 个")
