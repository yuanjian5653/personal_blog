from pathlib import Path
from dotenv import load_dotenv
import os

# 加载 .env（位于 blog-backend 根目录）
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    # 数据库
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

    # 跨域
    ALLOWED_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]

    # Session
    SESSION_EXPIRE_DAYS: int = int(os.getenv("SESSION_EXPIRE_DAYS", "7"))

    # 媒体目录（绝对路径）
    MEDIA_ROOT: Path = BASE_DIR / os.getenv("MEDIA_ROOT", "media")
    MUSIC_DIR: Path = BASE_DIR / os.getenv("MUSIC_DIR", "media/music")
    COVER_DIR: Path = BASE_DIR / os.getenv("COVER_DIR", "media/covers")
    PHOTO_DIR: Path = BASE_DIR / os.getenv("PHOTO_DIR", "media/photos")

    THUMB_DIR: Path = BASE_DIR / os.getenv("THUMB_DIR", "media/thumbs")
    # 调试
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"

    def ensure_dirs(self):
        """确保媒体目录存在"""
        for d in (self.MEDIA_ROOT, self.MUSIC_DIR, self.COVER_DIR, self.PHOTO_DIR, self.THUMB_DIR,):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()