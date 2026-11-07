"""
仪表盘接口（/api/admin/stats）的测试 —— 重点覆盖第二批图表。

覆盖：
  · 热力图 365 天、日期升序连续、字段齐全
  · 热力图的 views 总数 = 库中近一年的 PageView 行数（强不变量）
  · 热力图的 posts 总数 = 近一年 文章+随笔+动态 行数
  · 热力图的 comments 总数 = 近一年评论行数
  · 热门页面：条数 ≤ 8、按访问量降序、只含正数
  · 时段分布：正好 24 个桶、hour 是 0..23、合计 = 近 30 天 PageView 行数
  · 第一批图表没被破坏（卡片 / 两张趋势 / 两张分布）

用法：python scripts/test_dashboard.py --allow-production-db
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlmodel import Session

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from test_guard import guard  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.models import Admin, Article, Comment, Essay, LifePost, PageView  # noqa: E402
from app.routers.admin import HEATMAP_DAYS, TOP_PAGES, dashboard_stats  # noqa: E402

guard("test_dashboard.py")
init_db()

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


def _scalar(value) -> int:
    """func.count() 经 exec 有时返回 Row（取 [0]），有时直接是 int。"""
    if isinstance(value, (tuple, list)):
        return int(value[0] or 0)
    try:
        return int(value[0] or 0)
    except (TypeError, KeyError, IndexError):
        return int(value or 0)


with Session(engine) as db:
    row = db.exec(select(Admin)).first()
    admin = row if isinstance(row, Admin) else row[0]
    stats = dashboard_stats(db=db, _admin=admin)

# ------------------------------------------------------------------ 热力图
print("=== 1. 活动热力图 ===")
check("天数 = HEATMAP_DAYS", len(stats.heatmap), HEATMAP_DAYS)

dates = [d.date for d in stats.heatmap]
check("日期升序且连续", dates == sorted(dates), True)
check("没有重复日期", len(set(dates)), len(dates))

# 首尾日期应该正好差 HEATMAP_DAYS-1 天
first = datetime.fromisoformat(dates[0]).date()
last = datetime.fromisoformat(dates[-1]).date()
check("首尾相差 HEATMAP_DAYS-1 天", (last - first).days, HEATMAP_DAYS - 1)

check_true("每项都有 views/posts/comments",
           all(hasattr(d, "views") and hasattr(d, "posts") and hasattr(d, "comments")
               for d in stats.heatmap))
check_true("没有负数", all(d.views >= 0 and d.posts >= 0 and d.comments >= 0
                          for d in stats.heatmap),
           str([(d.date, d.views, d.posts, d.comments)
                for d in stats.heatmap if d.views < 0 or d.posts < 0 or d.comments < 0][:3]))

# ---- 与 SQL 对账 ----
heat_start = datetime.now(timezone.utc) - timedelta(days=HEATMAP_DAYS)
with Session(engine) as db:
    real_views = _scalar(
        db.exec(
            select(func.count()).select_from(PageView).where(
                PageView.created_at >= heat_start
            )
        ).one()
    )
    real_posts = 0
    for model in (Article, Essay, LifePost):
        real_posts += _scalar(
            db.exec(
                select(func.count()).select_from(model).where(
                    model.created_at >= heat_start
                )
            ).one()
        )
    real_comments = _scalar(
        db.exec(
            select(func.count()).select_from(Comment).where(
                Comment.created_at >= heat_start
            )
        ).one()
    )

sum_views = sum(d.views for d in stats.heatmap)
sum_posts = sum(d.posts for d in stats.heatmap)
sum_comments = sum(d.comments for d in stats.heatmap)

check("views 合计 = 库中近一年 PageView 行数", sum_views, int(real_views))
check("posts 合计 = 库中近一年内容行数", sum_posts, int(real_posts))
check("comments 合计 = 库中近一年评论行数", sum_comments, int(real_comments))

# 按北京时分桶时，边界那天的数据可能被算到相邻日期，
# 所以总量相等就说明没有漏计。若上面的等式都不成立，说明分桶丢了数据。

# ------------------------------------------------------------------ 热门页面
print("\n=== 2. 热门页面 ===")
check_true("条数不超过 TOP_PAGES", len(stats.top_pages) <= TOP_PAGES,
           str(len(stats.top_pages)))
check_true("只含正数访问量", all(p.value > 0 for p in stats.top_pages),
           str([(p.path, p.value) for p in stats.top_pages if p.value <= 0]))
values = [p.value for p in stats.top_pages]
check("按访问量降序", values == sorted(values, reverse=True), True)
check_true("路径非空", all(p.path for p in stats.top_pages))
check_true("没有重复路径",
           len({p.path for p in stats.top_pages}) == len(stats.top_pages))

# ------------------------------------------------------------------ 时段分布
print("\n=== 3. 访问时段分布 ===")
check("正好 24 个桶", len(stats.hour_distribution), 24)
check("hour 是 0..23", [h.hour for h in stats.hour_distribution], list(range(24)))
check_true("没有负数", all(h.value >= 0 for h in stats.hour_distribution))

trend_start = datetime.now(timezone.utc) - timedelta(days=30)
with Session(engine) as db:
    real_30d = _scalar(
        db.exec(
            select(func.count()).select_from(PageView).where(
                PageView.created_at >= trend_start
            )
        ).one()
    )
check("合计 = 近 30 天 PageView 行数",
      sum(h.value for h in stats.hour_distribution), int(real_30d))

# ------------------------------------------------------------------ 第一批图表
print("\n=== 4. 原有图表未被破坏 ===")
check_true("统计卡片非空", len(stats.cards) > 0, str(len(stats.cards)))
check_true("卡片字段齐全",
           all(c.key and c.label and isinstance(c.value, int) for c in stats.cards))
check("文章趋势 30 点", len(stats.article_trend), 30)
check("访客趋势 30 点", len(stats.visitor_trend), 30)
check_true("有范围字段", bool(stats.range_start and stats.range_end))
check_true("分类/浏览器分布是列表",
           isinstance(stats.category_distribution, list)
           and isinstance(stats.browser_distribution, list))

print()
if FAILS:
    print(f"[失败] {len(FAILS)} 项")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print("[通过] 仪表盘图表数据全部断言通过")
