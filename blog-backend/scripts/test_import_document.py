"""
文章文档导入（Markdown / Word）接口测试。

重点覆盖：
- .md 原样返回（不做改写）
- 标题推断：一级标题 > 首个非空行 > 文件名
- 编码：UTF-8 / UTF-8 BOM / GBK / UTF-16 都要能正确读出来
     （GBK 若被当 UTF-8 解，会得到乱码而不报错 —— 这是最难发现的问题）
- 扩展名白名单
- 空文件 / 超大文件
- 鉴权：未登录不能调用

用法：python scripts/test_import_document.py --allow-production-db
"""
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# test_guard：安全护栏 + 查询辅助（admin_id_of / ids_of）
from test_guard import admin_id_of, ids_of, guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.deps import get_current_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Admin  # noqa: E402

# 安全护栏：默认拒绝在非测试库上运行（这类脚本会连 .env 里的库）

guard("test_import_document.py")

engine = create_engine(settings.DATABASE_URL, echo=False)
FAILS: list[str] = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(f"{label}: got={got!r} want={want!r}")
        print(f"          got ={got!r}")
        print(f"          want={want!r}")


def check_true(label, cond, extra=""):
    print(f"  [{'OK ' if cond else 'FAIL'}] {label}")
    if not cond:
        FAILS.append(f"{label} {extra}")
        if extra:
            print(f"          {extra}")


def expect_raises(label, fn, status_code):
    try:
        fn()
    except Exception as e:
        code = getattr(e, "status_code", None)
        if code is None:
            print(f"  [FAIL] {label} -> {type(e).__name__}: {e}")
            FAILS.append(label)
            return
        check(label, code, status_code)
        return
    print(f"  [FAIL] {label} -> 没有抛异常")
    FAILS.append(label)


with Session(engine) as db:
    # 用 test_guard 里的辅助函数取标量 id
    # （本版本 db.exec(select(...)).first() 返回的是 Row）
    admin_id = admin_id_of(db, Admin)
if admin_id is None:
    print("没有管理员账号，跳过")
    raise SystemExit(0)

app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(id=admin_id)
client = TestClient(app)

MD = """# 我的第一篇文章

这是正文第一段，包含**加粗**和 `代码`。

## 二级标题

- 列表项 1
- 列表项 2

```python
print("hello")
```
"""

print("=== 1. Markdown：原样返回 ===")
r = client.post(
    "/api/articles/parse-document",
    files={"file": ("我的文章.md", MD.encode("utf-8"), "text/markdown")},
)
check("HTTP 200", r.status_code, 200)
data = r.json()
check("source = markdown", data.get("source"), "markdown")
check("标题取自一级标题", data.get("title"), "我的第一篇文章")
check("正文与原文完全一致（不做改写）", data.get("content"), MD.replace("\r\n", "\n"))
check("返回了文件名", data.get("filename"), "我的文章.md")

print("\n=== 2. 标题推断规则 ===")
cases = [
    ("# 一级标题\n正文", "一级标题", "有 # 一级标题"),
    ("## 二级标题\n正文", "二级标题", "只有二级标题时退回首行（去掉 ##）"),
    ("没有标题\n正文", "没有标题", "没有标题标记时用首行"),
    ("\n\n  \n# 空行后的标题", "空行后的标题", "跳过空行"),
    ("# 带尾井号的标题 ##", "带尾井号的标题", "去掉行尾 # 号"),
]
for content, want_title, label in cases:
    r = client.post(
        "/api/articles/parse-document",
        files={"file": ("fallback-name.md", content.encode("utf-8"), "text/markdown")},
    )
    check(label, r.json().get("title"), want_title)

print("\n=== 3. 编码兼容（关键：GBK 被误当 UTF-8 会变乱码）===")
cn_text = "# 中文标题\n\n这是一段中文正文，用来验证编码。\n"
encodings = [
    ("UTF-8", cn_text.encode("utf-8")),
    ("UTF-8 BOM", b"\xef\xbb\xbf" + cn_text.encode("utf-8")),
    ("GBK", cn_text.encode("gbk")),
    ("UTF-16 LE BOM", cn_text.encode("utf-16")),
]
for label, raw in encodings:
    r = client.post(
        "/api/articles/parse-document",
        files={"file": ("enc.md", raw, "text/markdown")},
    )
    got = r.json().get("content", "") if r.status_code == 200 else r.text
    check_true(
        f"{label} 能正确读出中文",
        "这是一段中文正文" in got,
        f"实际内容片段={got[:60]!r}",
    )

print("\n=== 4. 扩展名白名单 ===")
for name, ok in [
    ("a.md", True), ("a.markdown", True), ("a.MD", True),
    ("a.txt", False), ("a.pdf", False), ("a.exe", False),
]:
    r = client.post(
        "/api/articles/parse-document",
        files={"file": (name, b"# t\n", "application/octet-stream")},
    )
    label = f"{name} -> {'允许' if ok else '拒绝'}"
    if ok:
        check(label, r.status_code, 200)
    else:
        check(label, r.status_code, 400)

print("\n=== 5. 边界：空文件 / 只有空白 / 超大 ===")
r = client.post("/api/articles/parse-document",
                files={"file": ("empty.md", b"", "text/markdown")})
check("空文件 -> 400", r.status_code, 400)

r = client.post("/api/articles/parse-document",
                files={"file": ("blank.md", b"   \n\n\t\n", "text/markdown")})
check("只有空白 -> 400", r.status_code, 400)

big = b"# t\n" + b"x" * (21 * 1024 * 1024)
r = client.post("/api/articles/parse-document",
                files={"file": ("big.md", big, "text/markdown")})
check("超过 20MB -> 400", r.status_code, 400)

print("\n=== 6. 换行统一（CRLF -> LF）===")
r = client.post("/api/articles/parse-document",
                files={"file": ("crlf.md", b"# t\r\n\r\nline\r\n", "text/markdown")})
check("CRLF 被统一为 LF", "\r" in r.json()["content"], False)

print("\n=== 7. 鉴权 ===")
anon = TestClient(app)
# 注意：dependency_overrides 是全局的，所以这里直接验证依赖本身
from app.deps import get_current_admin as _dep  # noqa: E402

with Session(engine) as db:
    expect_raises("未登录（无 Cookie）-> 401", lambda: _dep(None, db), 401)
    expect_raises("伪造 token -> 401", lambda: _dep("fake-token", db), 401)

app.dependency_overrides.clear()

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项不通过：")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("[通过] 文档导入接口全部断言通过")
