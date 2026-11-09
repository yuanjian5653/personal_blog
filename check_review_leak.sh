cd /www/wwwroot/personal_blog/blog-backend
PY=$(systemctl cat blog-backend | sed -n 's/^ExecStart=\(\S*\).*/\1/p' | head -1)

"$PY" - <<'PYEOF'
import sys
sys.path.insert(0, '.')
import httpx
from sqlalchemy import text
from app.database import engine

BASE = "http://127.0.0.1:8000"   # 直连后端，不带任何 Cookie

TABLES = [
    ("essays", "/api/essays", "title"),
    ("life_posts", "/api/life", "content"),
    ("articles", "/api/articles?status=published", "title"),
]

print("=== 数据库里待审 / 驳回的记录 ===")
hidden = {}
with engine.connect() as c:
    for tbl, api, col in TABLES:
        rows = c.execute(text(
            "SELECT id, review_status, status, " + col + " FROM " + tbl +
            " WHERE review_status IN ('pending','rejected') ORDER BY id DESC LIMIT 10"
        )).fetchall()
        hidden[tbl] = [(r[0], r[1]) for r in rows]
        print("  " + tbl + ": " + str(len(rows)) + " 条")
        for r in rows:
            print("    id=%s review=%s status=%s  %s" % (r[0], r[1], r[2], str(r[3])[:30]))

print()
print("=== 匿名访问公开接口，看这些 id 有没有漏出来 ===")
problems = []
for tbl, api, col in TABLES:
    if not hidden[tbl]:
        print("  " + tbl + ": 没有待审/驳回记录，跳过")
        continue
    with httpx.Client(timeout=15) as cl:
        resp = cl.get(BASE + api)
    if resp.status_code != 200:
        print("  " + tbl + ": 接口返回 " + str(resp.status_code))
        continue
    ids = {item.get("id") for item in resp.json()}
    leaked = [i for i, _ in hidden[tbl] if i in ids]
    print("  " + tbl + ": 公开接口返回 %d 条，不该出现的 %d 条 %s" % (len(ids), len(leaked), leaked))
    if leaked:
        problems.append((tbl, leaked))

print()
if problems:
    print("  [X] 后端过滤有漏洞:", problems)
else:
    print("  [OK] 后端过滤正常：待审/驳回的内容都没有出现在公开接口里")
    print("       → 前台还能看到的话，就是浏览器缓存或管理员登录态导致的")
PYEOF
