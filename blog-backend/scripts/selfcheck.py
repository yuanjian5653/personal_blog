"""
后端自检脚本：确认应用能正常导入、路由完整、没有被重复注册。
用法：python scripts/selfcheck.py

注意：这个 FastAPI 版本把 include_router 的结果记成 _IncludedRouter，
不会立刻摊平到 app.routes，所以这里通过 app.openapi() 取真实路径清单。
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.main as m  # noqa: E402


EXPECTED_PREFIXES = {
    "/api/auth": "认证",
    "/api/music": "音乐",
    "/api/playlists": "歌单",
    "/api/site-config": "站点配置",
    "/api/albums": "图片组",
    "/api/netease": "网易云",
    "/api/essays": "随笔",
    "/api/articles": "文章",
    "/api/logs": "操作日志",
    "/api/life": "生活",
    "/api/upload": "上传",
}


def main() -> int:
    spec = m.app.openapi()
    paths = spec.get("paths", {})

    total_ops = sum(len(v) for v in paths.values())
    print(f"路径数: {len(paths)}，接口数(按方法计): {total_ops}")

    print("\n--- 各模块路由数 ---")
    missing = []
    for prefix, name in EXPECTED_PREFIXES.items():
        n = sum(1 for p in paths if p == prefix or p.startswith(prefix + "/"))
        if not n:
            missing.append(prefix)
        print(f"  {name:8s} {prefix:22s} {n:3d} 条  {'OK' if n else '!! 缺失'}")

    print("\n--- /api/essays 明细（确认没有重复注册）---")
    for p in sorted(paths):
        if p.startswith("/api/essays"):
            print(f"  {','.join(sorted(paths[p])):12s} {p}")

    # 检查路由函数名是否有重名冲突（重复注册的典型症状）
    names = Counter()
    for r in m.app.routes:
        sub = getattr(r, "routes", None)
        for sr in sub or []:
            names[getattr(sr, "name", "")] += 1
    conflicts = {k: v for k, v in names.items() if v > 1 and k}
    print(f"\n重名路由函数: {conflicts if conflicts else '无'}")

    if missing:
        print(f"\n[失败] 缺少路由前缀: {missing}")
        return 1
    if conflicts:
        print(f"\n[失败] 存在重复注册: {conflicts}")
        return 1

    print("\n[通过] 应用导入成功，所有模块路由齐全，无重复注册")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
