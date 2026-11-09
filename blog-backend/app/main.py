import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401  （导入以注册所有表）
from app.config import settings
from app.database import init_db
from app.routers import (
    admin,
    album,
    article,
    auth,
    authors,
    comments,
    easter_eggs,
    essay,
    friendlink,
    life,
    log,
    members,
    music,
    netease,
    notifications,
    playlist,
    project,
    reply_notifications,
    review,
    site_config,
    subscribe,
    tools,
    upload,
)
import asyncio

from app.services.scanner import scan_music_folder
from app.services import notifier
from app.services.watcher import start_watcher


# ---- 配置日志，让扫描/监控的信息能打印出来 ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- 启动 ----
    init_db()
    logger.info("[启动] 数据库表已就绪")

    # 1. 启动时先全量扫描一次（补齐上次关机期间漏掉的文件）
    stats = scan_music_folder()
    logger.info(f"[启动] 首次扫描完成：{stats}")

    # 2. 启动 watchdog 监控
    observer = start_watcher()
    # 把 observer 存到 app.state，关闭时用
    app.state.watcher = observer

    # 3. 启动内容更新通知 worker（asyncio 任务，1.6G 内存下比 Celery 轻得多）
    notify_task = asyncio.create_task(notifier.worker_loop(), name="notify-worker")
    app.state.notify_task = notify_task

    yield

    # ---- 关闭 ----
    if hasattr(app.state, "watcher"):
        app.state.watcher.stop()
        app.state.watcher.join()
        logger.info("[关闭] 文件监控已停止")

    # 取消通知 worker，等它真正退出再返回，避免留下悬挂任务
    task = getattr(app.state, "notify_task", None)
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        logger.info("[关闭] 通知 worker 已停止")


app = FastAPI(
    title="Personal Blog API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],

)
# 把 media 目录暴露为静态文件服务
# 访问 /media/photos/bg.jpg 就是 blog-backend/media/photos/bg.jpg
app.mount("/media", StaticFiles(directory=settings.MEDIA_ROOT), name="media")

# ---- 注册路由 ----
# ============================================================
# 安全响应头
# ============================================================
#
# 为什么放在应用层而不是只靠 nginx：
#   ① 本地开发 / 直连 8000 端口时也有保护
#   ② nginx 配置改错或换机器时不会静默失去保护
#
# 这几项都是"低风险高收益"的：
#   X-Content-Type-Options  禁止浏览器猜 MIME（防上传文件被当脚本执行）
#   X-Frame-Options         禁止被别的站用 iframe 套壳（防点击劫持）
#   Referrer-Policy         跨站时不泄漏站内路径
#   Permissions-Policy      关掉用不到的敏感能力（摄像头/麦克风/定位）
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    return response


app.include_router(auth.router)
app.include_router(music.router)
app.include_router(playlist.router)
app.include_router(site_config.router)
app.include_router(album.router)
app.include_router(netease.router)
app.include_router(essay.router)
app.include_router(article.router)
app.include_router(log.router)
app.include_router(life.router)
app.include_router(upload.router)
app.include_router(comments.router)
app.include_router(admin.router)
app.include_router(friendlink.router)
app.include_router(project.router)
app.include_router(tools.router)
app.include_router(subscribe.router)
app.include_router(subscribe.admin_router)
app.include_router(notifications.router)
app.include_router(reply_notifications.router)
app.include_router(easter_eggs.router)
app.include_router(easter_eggs.admin_router)
app.include_router(members.router)
app.include_router(authors.router)
app.include_router(review.router)

@app.get("/")
def root():
    return {"message": "Personal Blog API is running"}


@app.get("/api/health")
def health():
    # 刻意不返回 DEBUG、版本号之类的信息 —— 这些对攻击者是有用的侦察数据，
    # 对使用者没有价值。部署脚本只读 status 字段。
    return {"status": "ok"}