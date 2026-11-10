# 样式目录说明

这个目录是前台 + 后台的全部样式，**唯一的入口是 `app/globals.css`**。

```
app/globals.css          ← 只有 @import，没有规则
app/styles/
├── base/                基础与重置（2 个文件）
├── layout/              跨页面的骨架（4 个）
├── pages/               按页面/功能分（18 个）
├── admin/               后台（3 个）
└── effects/             彩蛋类（1 个）
```

---

## 为什么按"层"分而不是按"组件"分

Tailwind 4 处理 `@import` 是**按顺序拼接**的，后面的规则可以覆盖前面的。
所以目录顺序 = 覆盖顺序，不能随便调：

```
base   →  重置和变量，必须最先
layout →  骨架（导航栏 / 侧栏 / 通用小部件）
pages  →  具体页面（可以覆盖 layout 的通用规则）
admin  →  后台（独立于前台，靠 .admin-* 前缀隔离）
effects→  彩蛋（最后，允许盖掉任何东西）
```

> 举例：`essay-switch.css` 里说"覆盖在 home-cards 之上"，
> 所以它在 `globals.css` 里排在 `home-cards.css` 后面。**顺序动过就会变样**。

---

## 各目录放什么

### `base/`（2 个）

| 文件 | 内容 |
|---|---|
| `base.css` | CSS 变量（配色、圆角、阴影）、`*` 重置、`body` 背景、滚动条 |
| `animations.css` | 通用 `@keyframes`（淡入、浮动、脉冲） |

**新增**：全局变量放 `base.css`；新的通用动画放 `animations.css`。

### `layout/`（4 个）

| 文件 | 内容 |
|---|---|
| `navbar.css` | 顶部导航岛（含移动端抽屉） |
| `sidebar.css` | 前台左侧栏（个人卡片、归档、标签云） |
| `ui-widgets.css` | 跨页复用的小组件：相册堆叠、返回按钮、标签切换、波频条、昼夜开关 |
| `route-loading.css` | 路由切换的加载条 |

**新增**：**两个以上页面**用到的组件放这里；只有一个页面用的，放 `pages/`。

### `pages/`（18 个）

按"页面或功能块"一个文件。命名直接对应：

```
home-cards.css        首页卡片（随笔卡、文章翻转卡）
home-widgets.css      首页毛玻璃基类、骨架屏、双卡片布局
entry-cards.css       首页底部三入口（项目 / 工具 / 友链）
essay-switch.css      说说卡片的旋转轮播（覆盖 home-cards）
profile-socials.css   个人卡片的社交按钮
music-card.css        首页音乐卡片
music-page.css        /music 页
article.css           文章详情
article-card.css      文章列表项
archive.css           归档页
essays.css            说说页
life.css              生活页
friends.css           友链页
projects.css          项目页
tools.css             工具页
comments.css          评论区
subscribe.css         订阅页
replyNotify.css       站内回复通知
```

**新增**：新建 `pages/<页面名>.css`，然后在 `globals.css` 里按位置加一行 `@import`。

### `admin/`（3 个）

| 文件 | 内容 |
|---|---|
| `admin.css` | 基础原子类：`.admin-panel` `.admin-table` `.admin-field` `.admin-btn` `.admin-badge` `.admin-link` 等 |
| `admin-dashboard.css` | 仪表盘 |
| `admin-shell.css` | 后台外壳：侧栏、顶栏、布局 |

**约定**（写后台页面时照这个来，不要自己发明类名）：

```tsx
// 页面骨架：Tailwind 工具类
<div className="space-y-4">
  <div className="flex items-center justify-between flex-wrap gap-3">
    <h1 className="text-2xl font-bold">标题</h1>
  </div>

  // 面板
  <div className="admin-panel space-y-3">
    <div className="admin-panel__title">分组名</div>
    <div className="admin-filters">        {/* 横排表单 */}
      <label className="admin-field"><span>标签</span><input /></label>
    </div>
  </div>

  // 表格
  <div className="admin-panel admin-panel--flush">
    <table className="admin-table">…</table>
  </div>
</div>
```

> ⚠️ `.admin-field` 里的文字**必须**包在 `<span>` 里 —— 这条规则是按
> `span + input` 的选择器写的，直接写文字会排版错乱。
>
> ⚠️ 后台**没有 `select` 的样式**。需要选择项时用按钮组
> （`.admin-btn` 表示选中、`.admin-btn--ghost` 表示未选中）。

### `effects/`（1 个）

`easter-eggs.css` —— 暗号彩蛋 + 星空。和业务无关，可以整体删掉不影响功能。

---

## 加样式前的三个问题

1. **只有一个页面用吗？** → 是，放 `pages/<页面>.css`
2. **能复用已有的类吗？** → 先翻 `admin.css` / `ui-widgets.css`，八成已经有一个
   差不多够用的（`.admin-panel`、`.glass`、`.admin-badge--*`）
3. **需要被别的规则覆盖吗？** → 需要的话放前面，或者提高选择器特异性；
   **不要**用 `!important` 硬顶（现在全项目只有 2 处，都是有意的）

---

## 历史包袱（改动的风险点）

| 问题 | 现状 |
|---|---|
| 单文件过大 | `life.css` 1008 行、`admin-shell.css` 991 行。没拆是因为拆了要重排 `@import` 顺序，风险大于收益 |
| 少量重复的工具类 | 例如 `.fl-weight` 在 `friends.css` 里，别处想用就得连文件一起引 |
| `globals.css` 的顺序有隐含依赖 | 见上面的"覆盖顺序"，调整前务必跑 `pnpm build` 并肉眼过一遍页面 |

---

## 检查手段

```powershell
# 编译是否通过（CSS 语法错误会在这里暴露）
cd blog-frontend
npx next build

# 有没有跨文件重复定义了同一个选择器（历史上出现过）
python - <<'PY'
import pathlib, re, collections
seen = collections.defaultdict(list)
for f in pathlib.Path("app/styles").rglob("*.css"):
    for line in f.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([.#][\w-]+)\s*\{", line.strip())
        if m:
            seen[m.group(1)].append(f.name)
dups = {k: v for k, v in seen.items() if len(set(v)) > 1}
print(f"跨文件重复选择器: {len(dups)}")
for k, v in list(dups.items())[:10]:
    print(" ", k, "->", sorted(set(v)))
PY
```
