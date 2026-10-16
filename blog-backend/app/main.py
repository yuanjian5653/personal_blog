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
    comments,
    essay,
    friendlink,
    life,
    log,
    music,
    netease,
    playlist,
    project,
    site_config,
    upload,
)
from app.services.scanner import scan_music_folder
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

    yield

    # ---- 关闭 ----
    if hasattr(app.state, "watcher"):
        app.state.watcher.stop()
        app.state.watcher.join()
        logger.info("[关闭] 文件监控已停止")


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

@app.get("/")
def root():
    return {"message": "Personal Blog API is running"}


@app.get("/api/health")
def health():
    return {"status": "ok", "debug": settings.DEBUG}