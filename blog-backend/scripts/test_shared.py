"""
重构后的共享逻辑自检（不需要数据库）。
用法：python scripts/test_shared.py

覆盖：
- log_service.apply_updates  : 变更检测 / setattr / 日志写入 / 截断
- log_service JSON 数组读写  : 正常、空、脏数据
- article.calc_stats / make_slug
- 常量集合的一致性
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.constants import (  # noqa: E402
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    SUPPORTED_AUDIO_EXTENSIONS,
    WORD_EXTENSIONS,
)
from app.routers.article import calc_stats, make_slug  # noqa: E402
from app.services.log_service import (  # noqa: E402
    apply_updates,
    dumps_json_list,
    loads_json_list,
)

FAILURES = []


def check(label: str, got, want) -> None:
    ok = got == want
    if not ok:
        FAILURES.append(f"{label}: got={got!r} want={want!r}")
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
    if not ok:
        print(f"         got ={got!r}")
        print(f"         want={want!r}")


class FakeDB:
    """记录被 add 的对象，代替 SQLModel Session"""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)


class FakeObj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


print("=== apply_updates：只改真正变化的字段，并记一条日志 ===")
db = FakeDB()
obj = FakeObj(title="旧标题", artist="同一个人", sort_order=0)
changes = apply_updates(
    db, obj, {"title": "新标题", "artist": "同一个人"}, admin_id=1,
    target_type="demo", target_id=9,
)

check("title 被更新", obj.title, "新标题")
check("artist 保持不变", obj.artist, "同一个人")
check("只记录变化的字段", list(changes), ["title"])
check("changes 结构", changes["title"], {"old": "旧标题", "new": "新标题"})
check("写入了 1 条日志", len(db.added), 2)  # log + obj
log = db.added[0]
check("日志 action", log.action, "update")
check("日志 target_type", log.target_type, "demo")
check("日志 target_id", log.target_id, 9)
check("日志 changes", log.changes, {"title": {"old": "旧标题", "new": "新标题"}})

print("\n=== apply_updates：没有变化时不写日志 ===")
db2 = FakeDB()
obj2 = FakeObj(title="一样")
changes2 = apply_updates(
    db2, obj2, {"title": "一样"}, admin_id=1, target_type="demo", target_id=1
)
check("changes 为空", changes2, {})
check("只 add 了对象本身，没有日志", len(db2.added), 1)

print("\n=== apply_updates：max_value_len 截断（文章正文场景）===")
db3 = FakeDB()
obj3 = FakeObj(content="x" * 500)
changes3 = apply_updates(
    db3, obj3, {"content": "y" * 500}, admin_id=1, target_type="article",
    target_id=3, max_value_len=100,
)
check("new 值被截断到 100", len(changes3["content"]["new"]), 100)
check("old 值被截断到 100", len(changes3["content"]["old"]), 100)
check("对象上仍是完整值", len(obj3.content), 500)

print("\n=== JSON 数组读写 ===")
check("正常数组", loads_json_list('["a.jpg","b.jpg"]'), ["a.jpg", "b.jpg"])
check("空字符串", loads_json_list(""), [])
check("None", loads_json_list(None), [])
check("坏 JSON", loads_json_list("{不是json"), [])
check("不是数组", loads_json_list('{"a":1}'), [])
check("数组里的 None 被丢掉", loads_json_list('["a", null, ""]'), ["a"])
check("序列化保留中文", dumps_json_list(["图片", "b"]), '["图片", "b"]')
check("序列化 None", dumps_json_list(None), "[]")
check("往返一致", loads_json_list(dumps_json_list(["a", "中文.jpg"])), ["a", "中文.jpg"])

print("\n=== 文章字数 / slug ===")
wc, rt = calc_stats("你好世界")
check("纯中文 4 字", wc, 4)
check("阅读时长至少 1 分钟", rt, 1)
wc2, _ = calc_stats("hello world foo")
check("英文按单词计数", wc2, 3)
check("Markdown 符号被剔除（只剩 标题粗 三个汉字）",
      calc_stats("# 标题 **粗**").__getitem__(0), 3)
check("slug 用连字符连接", make_slug("Hello World"), "Hello-World")
check("空标题回退成 8 位随机串", len(make_slug("!!!")), 8)
check("中文 slug 保留", make_slug("我的第一篇"), "我的第一篇")

print("\n=== 扩展名常量一致性 ===")
check("AUDIO_EXTENSIONS 指向同一份集合", AUDIO_EXTENSIONS is SUPPORTED_AUDIO_EXTENSIONS, True)
check("音频只收 mp3/m4a（与 metadata 解析能力一致）",
      sorted(SUPPORTED_AUDIO_EXTENSIONS), [".m4a", ".mp3"])
check("图片含 bmp（upload.py 原本就收）", ".bmp" in IMAGE_EXTENSIONS, True)
check("图片含 avif", ".avif" in IMAGE_EXTENSIONS, True)
check("Word 只收 docx", sorted(WORD_EXTENSIONS), [".docx"])

print()
if FAILURES:
    print(f"[失败] {len(FAILURES)} 项不通过：")
    for f in FAILURES:
        print("  -", f)
    raise SystemExit(1)

print("[通过] 所有共享逻辑行为符合预期")
