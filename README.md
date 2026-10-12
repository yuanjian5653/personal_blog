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
| 文章 | Markdown 正文、分类、多标签筛选、置顶、阅读量/点赞、相关文章推荐、目录（TOC）、Word 文档导入 |
| 随笔 | 短文本 + 多图，时间轴分组展示，点赞 |
| 生活动态 | 图文动态、地点标记、瀑布流卡片 + 详情弹窗 / 图片灯箱 |
| 相册 | 相册分组、批量上传自动压缩、自动生成缩略图、灯箱浏览 |
| 音乐 | 扫描 `media/music/` 自动提取 mp3/m4a 标签与内嵌封面、歌词（LRC）、歌单、播放队列、频谱动画 |
| 网易云 | 通过 Cookie 代理搜索 / 歌单 / 歌词 / 音频流 |
| 站点配置 | 站点标题、主题色、背景（纯色/图片+模糊+遮罩）、卡片风格、社交链接、ICP 备案等，全部后台可改 |
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
| MySQL `personal_blog` 库 | 文章、随笔、动态、配置、日志、以及**图片/音频的文件名** |
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
│   │   ├── articles/ essays/ life/ music/ photos/ about/
│   │   ├── admin/                # 后台
│   │   └── styles/               # 拆分的 CSS
│   ├── components/               # 组件
│   ├── lib/
│   │   ├── api.ts                # API 客户端 + API_BASE（唯一来源）
│   │   ├── url.ts                # 图片 URL 解析
│   │   ├── format.ts             # 日期/时间格式化
│   │   ├── tags.ts               # 标签字符串解析
│   │   ├── lrc.ts                # LRC 歌词解析
│   │   ├── types.ts              # 类型 + 播放地址构造
│   │   └── useCachedFetch.ts     # 带 sessionStorage 缓存的请求 Hook
│   ├── scripts/
│   │   └── test_shared.mjs       # 共享模块断言测试
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

# 共享模块断言测试（49 项，不需要浏览器）
node --experimental-strip-types --loader ./scripts/ts-resolve-hook.mjs scripts/test_shared.mjs
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

`blog-frontend/.env.local`：

| 变量 | 默认 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | 后端地址，末尾不要带斜杠 |

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
