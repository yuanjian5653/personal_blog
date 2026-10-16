# 个人博客

一个自用的个人博客系统：文章、随笔、生活动态、相册、音乐播放器，外加一套内容管理后台。

- **前台**：Next.js 16 + React 19 + Tailwind CSS 4
- **后台 API**：FastAPI + SQLModel
- **数据库**：MySQL 8（注意：目前只支持 MySQL，见下方「数据库」一节）
- **音乐**：本地音频扫描入库 + 网易云接口代理，播放器基于 APlayer

---

## 功能一览

| 模块 | 说明 |
|---|---|
| 文章 | Markdown 正文、分类、多标签筛选、置顶、阅读量/点赞、相关文章推荐、目录（TOC）、Word (.docx) / Markdown (.md) 文档导入 |
| 随笔 | 短文本 + 多图，同日卡片叠成"一摞纸条"随机倾斜，点击丝滑下拉展开，点赞 |
| 评论 | **访客用 GitHub 登录后**在「说说」和「生活动态」下评论 / 一级回复 / 点赞；也可给说说点赞。数据存 MySQL，登录态与管理员完全隔离 |
| 生活动态 | 图文动态、地点标记、瀑布流卡片 + 详情弹窗 / 图片灯箱 |
| 相册 | 相册分组、批量上传自动压缩、自动生成缩略图、灯箱浏览 |
| 友链 | 圆形卡片按**权重**决定大小与光晕，入场像流星飞入（回弹 + 拖尾），之后自由流动并相互碰撞，点击卡片弹出气泡详情；后台可设网址/名称/类型/简介/封面/权重 |
| 音乐 | 扫描 `media/music/` 自动提取 mp3/m4a 标签与内嵌封面、歌词（LRC）、歌单、播放队列、频谱动画 |
| 网易云 | 通过 Cookie 代理搜索 / 歌单 / 歌词 / 音频流 |
| 站点配置 | 站点标题、主题色、背景（纯色/图片+模糊+遮罩）、卡片风格、社交链接、ICP 备案等，全部后台可改 |
| 后台看板 | 已发布/草稿/分类/标签/评论/访客 六张统计卡 + 文章发布趋势、访客趋势（近30天）+ 分类分布、浏览器分布环形图 |
| 评论管理 | 后台统一管理文章/说说/生活动态/杂谈的评论：位置与状态筛选、关键词搜索、分页、展开查看回复、通过/拒绝、删除 |
| 操作日志 | 后台增删改自动记录，支持筛选与展开查看字段级变更 |
| 认证 | 基于 HttpOnly Cookie 的 Session 登录（bcrypt 哈希存密码） |

---

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Python | 3.11+（开发环境用的 3.13） | 后端 |
| MySQL | 8.0+ | 数据库 |
| Node.js | 20+（开发环境用的 24） | 前端 |
| pnpm | 10+ | 前端包管理（也可用 npm / yarn，需自行改 `start.bat`） |

---

## 快速开始

以下命令都在**项目根目录**执行。

### 1. 拉取代码

```bash
git clone https://github.com/<你的用户名>/personal_blog.git
cd personal_blog
```

### 2. 创建 Python 虚拟环境并安装后端依赖

```bash
python -m venv .venv

# Windows
.venv\Scripts\python.exe -m pip install -r blog-backend\requirements.txt

# Linux / macOS
.venv/bin/python -m pip install -r blog-backend/requirements.txt
```

### 3. 安装前端依赖

```bash
cd blog-frontend
pnpm install
cd ..
```

### 4. 配置数据库连接

复制模板：

```bash
# Windows
copy blog-backend\.env.example blog-backend\.env

# Linux / macOS
cp blog-backend/.env.example blog-backend/.env
```

然后打开 `blog-backend/.env`，**把 `DATABASE_URL` 改成你自己的 MySQL 账号密码**：

```ini
DATABASE_URL=mysql+pymysql://用户名:密码@localhost:3306/personal_blog?charset=utf8mb4
```

数据库本身**不需要你手动创建**——下一步的初始化脚本会建。

### 5. 初始化数据库 + 创建管理员

```bash
# Windows
.venv\Scripts\python.exe blog-backend\scripts\init_db.py

# Linux / macOS
.venv/bin/python blog-backend/scripts/init_db.py
```

这个脚本会自动完成四件事：

1. 检查 `.env`（不存在就从模板生成并提示你填）
2. 检查能否连上 MySQL（连不上会给出具体的排查清单，而不是让应用启动时崩掉）
3. 创建数据库（utf8mb4）并建好所有数据表
4. 交互式让你设置**管理员用户名和密码**

> 想无人值守可以用参数：
> ```bash
> python blog-backend/scripts/init_db.py --admin-user admin --admin-password '你的密码'
> ```
> 只想预览不实际改动：加 `--dry-run`。
> 只想建库建表、稍后自己建管理员：加 `--skip-admin`。

### 6. 配置前端（可选）

前端默认连 `http://localhost:8000`，本地开发**可以跳过这步**。

要改的话：

```bash
# Windows
copy blog-frontend\.env.example blog-frontend\.env.local
# Linux / macOS
cp blog-frontend/.env.example blog-frontend/.env.local
```

### 7. 启动

```bash
# Windows：双击 start.bat
start.bat

# Linux / macOS / Git Bash
bash start.sh
```

或手动开两个终端分别启动：

```bash
# 终端 1 —— 后端
cd blog-backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# 终端 2 —— 前端
cd blog-frontend
pnpm dev
```

启动后：

| 入口 | 地址 |
|---|---|
| 前台首页 | http://localhost:3000 |
| 后台登录 | http://localhost:3000/admin/login |
| 接口文档（Swagger） | http://localhost:8000/docs |

用第 5 步设置的管理员账号登录后台。

---

## 数据库

### 当前只支持 MySQL

`DATABASE_URL` 必须以 `mysql+pymysql://` 开头。代码里用了 MySQL 专有特性：

- `models/article.py`、`models/essay.py` 用 `LONGTEXT`（MySQL 类型）
- `routers/article.py` 用 `find_in_set()` 做标签 AND 筛选
- `routers/essay.py` 用 `rand()` 取随机随笔

换成 SQLite / PostgreSQL 需要先把这几处改成方言无关写法。

### 表结构是怎么来的

没有迁移工具（Alembic）。表由 `SQLModel.metadata.create_all()` 按 `app/models/` 下的模型自动创建。

> ⚠️ **`create_all` 只建"不存在的表"，不会修改已有表的结构。**
> 如果你改了模型（比如加字段），现有数据库不会自动同步。这种情况需要手动 `ALTER TABLE`，或引入迁移工具。

### 数据都存在哪

**MySQL 里只存文字内容和文件名，图片/音频本体在磁盘上。** 备份时两个都要备：

| 位置 | 内容 |
|---|---|
| MySQL `personal_blog` 库 | 文章、随笔、动态、**评论/点赞/访客账号**、配置、日志、以及**图片/音频的文件名** |
| `blog-backend/media/photos/` | 相册原图 |
| `blog-backend/media/thumbs/` | 自动生成的缩略图 |
| `blog-backend/media/covers/` | 从音频文件里提取的内嵌封面 |
| `blog-backend/media/music/` | 音频文件（放进这个目录会自动入库） |

---

## 项目结构

```
personal_blog/
├── blog-backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py               # 应用入口、路由注册、CORS、静态文件
│   │   ├── config.py             # 读取 .env 的配置
│   │   ├── constants.py          # 允许上传的扩展名
│   │   ├── database.py           # 引擎、Session、建表
│   │   ├── deps.py               # 登录态依赖（get_current_admin）
│   │   ├── models/               # SQLModel 表定义
│   │   ├── schemas/              # 请求/响应模型
│   │   ├── routers/              # 各模块接口
│   │   └── services/             # 业务逻辑（扫描、图片、元数据、流式传输等）
│   ├── media/                    # 上传的图片与音频
│   ├── scripts/
│   │   ├── init_db.py            # 一键初始化（建库/建表/建管理员）
│   │   ├── selfcheck.py          # 自检：路由是否完整、有无重复注册
│   │   ├── test_shared.py        # 共享逻辑的行为测试
│   │   ├── db_info.py            # 查看数据库表与行数
│   │   └── generate_thumbs.py    # 批量为已有图片补缩略图
│   ├── .env.example              # 配置模板（可提交）
│   └── requirements.txt
│
├── blog-frontend/                # Next.js 前端
│   ├── app/                      # 页面（App Router）
│   │   ├── articles/ essays/ life/ music/ photos/ about/ friends/
│   │   ├── admin/                # 后台
│   │   └── styles/               # 拆分的 CSS
│   ├── components/               # 组件
│   ├── lib/
│   │   ├── api.ts                # API 客户端 + API_BASE（唯一来源）
│   │   ├── url.ts                # 图片 URL 解析
│   │   ├── format.ts             # 日期/时间格式化
│   │   ├── tags.ts               # 标签字符串解析
│   │   ├── lrc.ts                # LRC 歌词解析
│   │   ├── physics.ts            # 友链卡片的 2D 物理（纯函数，可测）
│   │   ├── types.ts              # 类型 + 播放地址构造
│   │   └── useCachedFetch.ts     # 带 sessionStorage 缓存的请求 Hook
│   ├── scripts/
│   │   ├── test_shared.mjs       # 共享模块断言测试
│   │   ├── test_typewriter.mjs   # 打字机状态机
│   │   ├── test-physics.mjs      # 友链物理
│   │   └── test-dom-nesting.mjs  # 检查 a/Link 嵌套
│   └── .env.example
│
├── start.bat / start.sh          # 一键启动
└── .gitignore
```

---

## 常用命令

### 后端

```bash
cd blog-backend

# 启动（开发模式，改代码自动重载）
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# 自检：确认应用能导入、路由完整、没有重复注册
..\.venv\Scripts\python.exe scripts\selfcheck.py

# 共享逻辑测试（不需要数据库）
..\.venv\Scripts\python.exe scripts\test_shared.py

# 接口测试（会写入并清理测试数据，默认拒绝在生产库上跑）
..\.venv\Scripts\python.exe scripts\test_comments.py
..\.venv\Scripts\python.exe scripts\test_admin_api.py
..\.venv\Scripts\python.exe scripts\test_friend_links.py
..\.venv\Scripts\python.exe scripts\test_import_document.py
# 确实要在当前库上跑时：加 --allow-production-db

# 查看数据库现状（表、行数、占用空间）
..\.venv\Scripts\python.exe scripts\db_info.py

# 为已存在的图片批量补缩略图
..\.venv\Scripts\python.exe -m scripts.generate_thumbs
```

### 前端

```bash
cd blog-frontend

pnpm dev            # 开发服务器
pnpm build          # 生产构建
pnpm lint           # ESLint

# 纯逻辑断言测试（不需要浏览器）
node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test_shared.mjs      # 共享模块 49 项
node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test_typewriter.mjs # 打字机 16 项
node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test-physics.mjs    # 友链物理 20 项
node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test-dom-nesting.mjs # 标签嵌套检查
```

---

## 配置项说明

`blog-backend/.env` 里的关键项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | — | **必填**。MySQL 连接串 |
| `ALLOWED_ORIGINS` | — | 允许跨域的前端地址，逗号分隔。**部署时必须改成你的域名** |
| `SESSION_EXPIRE_DAYS` | `7` | 登录保持天数 |
| `DEBUG` | `True` | `True` 会打印每条 SQL，生产环境建议改 `False` |
| `MEDIA_ROOT` / `MUSIC_DIR` / `COVER_DIR` / `PHOTO_DIR` / `THUMB_DIR` | `media/...` | 媒体目录，相对 `blog-backend/` |
| `NETEASE_MUSIC_U` | 空 | 网易云 Cookie。**也可以不填 `.env`**，登录后台后在音乐页填入即可（会存进数据库） |
| `FRONTEND_URL` | `http://localhost:3000` | GitHub 登录完成后跳回哪里 |
| `BACKEND_URL` | `http://localhost:8000` | 后端对外地址。拼 OAuth 回调地址用，**必须与 GitHub OAuth App 里填的一致** |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 空 | 访客 GitHub 登录用，见下方「评论功能」 |
| `COMMENTER_SESSION_DAYS` | `30` | 访客登录态保持天数 |
| `COOKIE_SAMESITE` | `lax` | 前后端**不同域**部署时改成 `none` |
| `COOKIE_SECURE` | `false` | 配合上一条，不同域 + HTTPS 时改 `true` |

`blog-frontend/.env.local`：

| 变量 | 默认 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | 后端地址，末尾不要带斜杠 |

---

## 评论功能（GitHub 登录）

访客用 GitHub 账号登录后可以：发表评论、回复（一级）、给评论点赞、给说说点赞。
所有数据都存在 MySQL 里（`commenters` / `comments` / `comment_likes` / `essay_likes` / `commenter_sessions` 五张表）。

> **⚠️ 关于 OAuth 凭据：仓库里不包含，也不需要包含。**
> `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 属于**每个部署者自己的**凭据，
> 只存在于本地 `blog-backend/.env`（已被 `.gitignore` 忽略）。
> 仓库里提供的是 `.env.example` 模板 —— 里面这两项都是**空的**，等你填自己的。
> 这样设计的原因：
> - `GITHUB_CLIENT_SECRET` 是密钥，提交上去等于公开凭据
> - OAuth App 的回调地址是**按域名注册**的，别人的凭据在你的域名上根本用不了
>
> 所以克隆本项目后，照下面三步申请**你自己的** OAuth App 即可。

### 1. 申请 GitHub OAuth App

1. 打开 <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
   > 注意是 **OAuth App**，不是 **GitHub App**。两者换 token 的端点不同，
   > 用错会在登录时报 `incorrect_client_credentials`。
2. 填写：
   - **Application name**：随意，例如 `personal-blog`
   - **Homepage URL**：前端地址，例如 `http://localhost:3000`
   - **Authorization callback URL**：**必须**填
     ```
     http://localhost:8000/api/comments/github/callback
     ```
     规则是 `${BACKEND_URL}/api/comments/github/callback`，**必须完全一致**，
     否则 GitHub 会报 `redirect_uri_mismatch`
3. 创建后复制 **Client ID**，再点 **Generate a new client secret** 拿 **Client Secret**

### 2. 填进 `.env`

把 `blog-backend/.env.example` 复制为 `blog-backend/.env`，然后填：

```env
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:8000
GITHUB_CLIENT_ID=你的 Client ID
GITHUB_CLIENT_SECRET=你的 Client Secret
```

改完**重启后端**。没配这两项时，评论列表仍能正常浏览，但点「GitHub 登录」会返回 503 并提示未配置。

### 3. 说明

- **新库不需要迁移**：表由 `SQLModel.metadata.create_all` 自动创建，重启后端即生效
- **已有数据库需要跑一次迁移**：评论表先后扩展过"生活动态""文章""留言板"，
  还加了 `ip` / `status` 两个审核字段，并新增了 `page_views` 访问统计表。
  因为 `create_all` 不会修改已有表结构，请执行一次：
  ```bash
  python blog-backend/scripts/migrate_comments_target.py --dry-run   # 先看会改什么
  python blog-backend/scripts/migrate_comments_target.py            # 执行
  ```
  脚本是**幂等**的，重复执行不会出错。
- 申请时**不要**勾选 `repo` 等权限，本项目只申请 `read:user`（读公开资料）
- 登录态用的是**独立的 Cookie**（`commenter_token`），与管理员的 `session_token` 完全分开，
  互不影响：管理员登录不会让访客变成"已登录评论用户"，反之亦然
- 访客只能删除自己的评论；删除父评论时会连带删掉它的一级回复与点赞
- 评论支持**两种目标**：说说（`/api/comments/essay/{id}/...`）和生活动态
  （`/api/comments/life/{id}/...`）。两者数据完全隔离，不会串号
- 登录后会自动**跳回你发起登录的那个页面**（靠 `return_to`），不会一律回首页
- 登录成功/失败都会在页面右上角弹出提示；失败时会显示 GitHub 返回的具体原因

### 4. 网络受限怎么办（中国大陆常见）

如果你的网络直连 `github.com` 不通、需要靠加速器/代理才能打开 GitHub，
**后端也必须显式走同一个代理** —— 因为 `httpx` **不会**读取 Windows 系统代理或 PAC 脚本。
典型症状：浏览器能正常打开 GitHub、也能完成授权，但点完登录后报
`ConnectTimeout`，或者页面提示"登录失败：后端连接 GitHub 失败"。

**先诊断**：

```bash
python blog-backend/scripts/diagnose_github_net.py
```

它会分别测 `github.com`、`api.github.com` 的 DNS / TCP / HTTPS，
并列出本机监听的端口，最后给出该怎么做。

**然后按情况处理**：

| 情况 | 做法 |
|---|---|
| 有本机代理端口 | 在 `.env` 里加 `GITHUB_PROXY=http://127.0.0.1:端口`，重启后端（端口看你自己的代理软件） |
| 代理走系统环境变量 | 启动后端前设 `HTTPS_PROXY`，并设 `NO_PROXY=localhost,127.0.0.1`（否则本机请求也会被塞进代理） |
| 只信任系统代理/PAC | 上面两项都不行时，在加速器里开启「TUN 模式 / 全局模式」，让所有程序都走代理 |

> 诊断脚本会把**本机正在监听的端口**列出来，照着填 `GITHUB_PROXY` 即可。

> **关于证书**：这类加速器通常做 HTTPS 中间人，用**自签证书**替换 GitHub 的证书。
> 浏览器信任它（根证书装在系统里），但 Python 默认只用 `certifi`，会报
> `CERTIFICATE_VERIFY_FAILED`。
> 本项目已自动把**操作系统证书存储**里的证书一并载入
> （见 `app/services/github_oauth.py` 的 `_ssl_context()`），
> 所以**不需要**关闭证书校验。

### 5. 生产部署注意

前后端**同域**（例如都用 `https://blog.example.com`，后端挂在 `/api`）时无需额外配置。

若前后端**不同域**，浏览器默认不会带上跨站 Cookie，需要：

```env
COOKIE_SAMESITE=none
COOKIE_SECURE=true      # 必须配合 HTTPS
ALLOWED_ORIGINS=https://你的前端域名
```

并且把 GitHub OAuth App 的 callback 地址改成生产环境的
`https://你的后端域名/api/comments/github/callback`。

---

## 后台功能

### 仪表盘看板

进入 `/admin/dashboard` 可以看到：

- **六张统计卡**：已发布文章、草稿、分类、标签、评论、访客（近30天去重）
- **两张趋势图**：文章发布趋势、访客趋势（近 30 天）
- **两张分布图**：分类分布、浏览器分布（环形图）

图表是**手写 SVG**，没有引入任何图表库 —— 只需要"平滑曲线 + 渐变填充 + 环形占比"，
引一个图表库要多几百 KB，且 SSR 下还要额外处理。

**访客数据来自前台上报**：`components/VisitTracker.tsx` 会在每次路径变化时
调用 `POST /api/admin/track`。几个设计点：

- 后台路径（`/admin*`）不计入统计
- 同一访客 + 同一路径在 **6 小时内只记一次**，避免刷新灌水
- 访客标识 = `hash(IP + UA + 当日日期)`，**无法跨天追踪**（隐私上更克制）
- 记录 IP 但**不信任** `X-Forwarded-For`（那是客户端可伪造的头）

> 趋势图一开始会是空的 —— 埋点是本次新增的，只统计**从现在开始**的访问。

### 评论管理

后台侧栏「互动」分组下有两个入口：

| 页面 | 作用 |
|---|---|
| `/admin/comments` | 统一管理**文章 / 说说 / 生活动态 / 杂谈**的评论 |
| `/admin/guestbook` | 只看留言板（同一个组件，固定 target=guestbook） |

支持：
- 按**位置**（文章/说说/生活动态/杂谈）和**状态**（已通过/已拒绝）筛选
- 按内容或用户名**关键词搜索**
- 分页
- 点「N 条回复」**下拉展开**该条评论的所有回复，回复也能单独通过/拒绝/删除
- 删除顶层评论会**连带删除它的回复与点赞**

审核状态说明：`rejected` 的评论**不在前台展示**（公开接口只返回 `approved`），
但记录保留，可以随时改回 `approved`。

### 友链管理

后台侧栏「内容」分组下的 **友链管理**（`/admin/friends`）。每条友链有六个字段：

| 字段 | 说明 |
|---|---|
| 名称 | 站点名（必填） |
| 网址 | 必填。**不写 `https://` 会自动补**，避免填成相对路径结果跳到自己站内 |
| 类型 | 例如 技术 / 设计 / 生活，前台显示为卡片上的小标签 |
| 简介 | 一句话介绍，显示在气泡详情里 |
| 封面 | 可上传（≤5MB）或直接粘图片地址；没有封面时用名称首字做占位 |
| 权重 | **决定前台的突出程度**；另有一个「排序」用于同权重时的先后 |

另外有「显示 / 隐藏」开关：隐藏的友链不出现在前台，但记录保留。

权重不必纠结填多大 —— 前台会按**当前列表内的 min/max 归一化**再映射到
卡片尺寸（96~200px），所以填 0~10 和填 0~1000 的视觉效果是一样的。

### 友链页的动效是怎么做的

前台 `/friends` 的卡片是**圆**而不是矩形，因为圆形没有方向感，自由流动时更自然，
而且大小对比更直觉 —— 正好用来表达权重。

三件事分别的实现方式：

1. **流星飞入（回弹 + 拖尾）**：每张卡片从画面外斜向飞来，用 `easeOutBack`
   缓动 —— 它会**冲过目标再回弹**，这就是回弹感的来源（普通 ease-out 落位很平）。
   拖尾是一层沿速度方向旋转、拉伸的渐变，飞入时最亮最长，落位后淡出。
2. **随机排布**：初始位置用「网格 + 格内抖动」，并保证**格子边长 ≥ 卡片直径**，
   所以从数学上不会一开局就重叠。位置用 `id` 做种子生成，因此每次刷新一致，
   不会闪来闪去。
3. **自由流动 + 碰撞**：`lib/physics.ts` 是一个纯函数 2D 物理（圆-圆弹性碰撞 +
   边界反弹 + 微小随机扰动）。物理每帧只改 DOM 的 `transform`，**不触发 React
   重渲染**，所以几十张卡片也很流畅。质量按半径平方算，大的更"沉"、被撞动更少。

物理逻辑单独抽成模块并配了测试（`scripts/test-physics.mjs`，20 项断言）——
因为"越界 / 挤成一团 / 速度发散"这类问题肉眼看动画很难发现，用数值断言一测就出来
（开发时确实抓到了初始布局会重叠的 bug）。

已适配 `prefers-reduced-motion`：系统开了"减少动效"时，不做飞入也不做物理，
改成静态网格排布，避免这类用户被满屏乱动的东西打扰。

---

### 文章导入（Word / Markdown）

后台「文章管理」右上角的 **📄 导入文档** 按钮，支持两种文件，都会转成 Markdown 正文：

| 格式 | 处理方式 |
|---|---|
| `.md` / `.markdown` | 本身就是 Markdown，**原样读取**，不做任何转换或清理 |
| `.docx` | 用 markitdown 转成 Markdown |

流程：选文件 → 后端解析（`POST /api/articles/parse-document`）→ 标题与正文填入**新建文章页** →
你确认分类、标签后再保存。**解析阶段不写数据库**，不会产生半成品文章。

几个实现细节：

- **标题推断**：优先取第一个 `# 一级标题`；没有就退回第一个非空行（去掉 `#` / `>` / `-` 等前缀）；
  都没有才用文件名。所以文件名不必费心取
- **编码兼容**：中文环境里 Markdown 常见 GBK 编码，而把 GBK 字节按 UTF-8 解**通常不报错、
  只得到乱码** —— 那比报错更难发现。所以解析按 `BOM → UTF-8（严格）→ GBK` 顺序尝试，
  全失败才提示「请另存为 UTF-8」，避免"导入成功但全是乱码"
- **换行**：CRLF 统一成 LF
- 限制：单文件 ≤ 20MB；扩展名白名单（其它格式直接拒绝）

---

## 常见问题

**`pip install -r requirements.txt` 报解析错误**

如果你拿到的是旧版本仓库，`requirements.txt` 曾是 UTF-16 编码会导致这个问题。当前已修正为 UTF-8 最小清单。

**启动后端报 `Can't connect to MySQL server` / `Unknown database`**

按顺序检查：
1. MySQL 服务启动了吗？Windows：`net start MySQL80`
2. `localhost:3306` 通吗？
3. `.env` 里的用户名密码对吗？
4. 数据库建了吗？—— 跑 `python blog-backend/scripts/init_db.py`

**后台登录不了 / 提示用户名或密码错误**

数据库里还没有管理员账号。跑：

```bash
python blog-backend/scripts/init_db.py
```

**改了模型但数据库没更新**

`create_all` 不会改已有表。需要手动 `ALTER TABLE`，或删库重建（会丢数据，谨慎）。

**上传的图片看不到**

确认 `blog-backend/media/photos/` 和 `media/thumbs/` 存在且有写权限。目录会在应用启动时自动创建。

**文章里的音乐/图片加载不出来**

前台是通过 `NEXT_PUBLIC_API_BASE_URL` 拼图片地址的，确认它指向的后端确实在跑。

**网易云歌曲无法播放**

多半是 VIP 或版权限制（后端会返回 404），或 Cookie 失效——重新从浏览器复制 `MUSIC_U` 到后台音乐页。

---

## 部署提示

1. **改 `ALLOWED_ORIGINS`** 为你的前端域名，否则浏览器会因 CORS 拒绝请求
2. **`DEBUG` 设为 `False`**，否则日志会被 SQL 刷屏
3. **`secure=True`**：`routers/auth.py` 里设置 Cookie 时目前是 `secure=False`（本地 HTTP 用）。上 HTTPS 后应改为 `True`，否则 Cookie 会明文传输
4. **不要提交 `.env`**：`.gitignore` 已排除，请确认里面没有真实凭据
5. **备份**：MySQL 和 `media/` 目录都要备

```bash
# 数据库备份
mysqldump -u 用户名 -p personal_blog > backup.sql

# 媒体文件备份
# 直接打包 blog-backend/media/ 目录
```

---

## 说明

- `Meting-API/` 不在本仓库中（它是自带独立 Git 仓库的第三方项目）。需要的话自行 clone 到该目录。
- `blog-backend/.env.example` 和 `blog-frontend/.env.example` 是可提交的模板，请勿把真实凭据写进模板。

## License

个人项目，未指定开源协议。如需引用请先联系作者。
