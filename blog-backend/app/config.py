from pathlib import Path
from dotenv import load_dotenv
import os

# 加载 .env（位于 blog-backend 根目录）
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() == "true"


class Settings:
    # 数据库
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

    # 跨域
    ALLOWED_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]

    # Session
    SESSION_EXPIRE_DAYS: int = int(os.getenv("SESSION_EXPIRE_DAYS", "7"))

    # ---- 前端地址（OAuth 回调后跳回这里）----
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

    # 后端自身对外地址（拼 OAuth 回调地址用，必须与 GitHub OAuth App 里填的一致）
    BACKEND_URL: str = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")

    # ---- GitHub OAuth（用于访客登录评论）----
    GITHUB_CLIENT_ID: str = os.getenv("GITHUB_CLIENT_ID", "")
    GITHUB_CLIENT_SECRET: str = os.getenv("GITHUB_CLIENT_SECRET", "")

    # OAuth 用到的两个地址。默认走 HTTPS；
    # 若你的网络拦截了 https://github.com 的出站（表现为 ConnectTimeout），
    # 把 GITHUB_OAUTH_TOKEN_URL 改成 HTTP 端点即可绕过：
    #     GITHUB_OAUTH_TOKEN_URL=http://github.com/login/oauth/access_token
    # 先跑 scripts/diagnose_github_net.py 确认到底哪个通。
    GITHUB_OAUTH_TOKEN_URL: str = os.getenv(
        "GITHUB_OAUTH_TOKEN_URL", "https://github.com/login/oauth/access_token"
    )
    GITHUB_API_USER_URL: str = os.getenv(
        "GITHUB_API_USER_URL", "https://api.github.com/user"
    )

    # 走哪个代理访问 GitHub。留空则用 httpx 默认行为
    # （自动读取 HTTPS_PROXY / HTTP_PROXY 环境变量）。
    #
    # 为什么需要单独一项：httpx **不会**读取 Windows 系统代理或 PAC 脚本。
    # 如果你靠本机 PAC（如 Watt Toolkit/SteamTools 的
    # http://127.0.0.1:26561/pac）才能访问 GitHub，就填：
    #     GITHUB_PROXY=http://127.0.0.1:26561
    # 这样只有 GitHub 请求走代理，本机 MySQL/接口不受影响，
    # 也就不需要再去配 NO_PROXY。
    GITHUB_PROXY: str | None = os.getenv("GITHUB_PROXY") or None

    # 访问 GitHub 的超时（秒）
    GITHUB_TIMEOUT: float = float(os.getenv("GITHUB_TIMEOUT", "20"))

    # ---- GitHub 项目展示（/projects 页面）----
    # 展示哪个账号的仓库。留空则项目页显示"未配置"提示。
    GITHUB_USERNAME: str = os.getenv("GITHUB_USERNAME", "")
    # 可选的只读 token：不填也能用（公开仓库走匿名接口），
    # 但匿名每小时只有 60 次请求，填了可以到 5000 次 —— 建议填。
    # 只需要 public_repo 读取权限（classic token 不勾任何 scope 即可读公开仓库）。
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
    # 只展示这些语言（逗号分隔，空 = 不限制）。例如：Python,TypeScript
    GITHUB_REPO_LANGUAGES: str = os.getenv("GITHUB_REPO_LANGUAGES", "")
    # 是否把 fork 的仓库也展示出来。
    # 默认不展示：fork 通常不是"自己的项目"，混在一起会显得很水。
    # 如果你的好项目里有 fork（比如基于别人的模板改的），可以设 true。
    GITHUB_REPO_INCLUDE_FORKS: bool = _env_bool("GITHUB_REPO_INCLUDE_FORKS", False)

    # ---- Cookie 安全策略 ----
    # 本地开发是 http://localhost 跨端口，属于同站，用 lax 即可；
    # 生产若前后端不同域，需要 COOKIE_SAMESITE=none 且 COOKIE_SECURE=true。
    COOKIE_SECURE: bool = _env_bool("COOKIE_SECURE", False)
    COOKIE_SAMESITE: str = os.getenv("COOKIE_SAMESITE", "lax").lower()

    # 访客登录态有效期（天）
    COMMENTER_SESSION_DAYS: int = int(os.getenv("COMMENTER_SESSION_DAYS", "30"))

    # 单条评论最大长度
    COMMENT_MAX_LENGTH: int = int(os.getenv("COMMENT_MAX_LENGTH", "2000"))

    # 媒体目录（绝对路径）
    MEDIA_ROOT: Path = BASE_DIR / os.getenv("MEDIA_ROOT", "media")
    MUSIC_DIR: Path = BASE_DIR / os.getenv("MUSIC_DIR", "media/music")
    COVER_DIR: Path = BASE_DIR / os.getenv("COVER_DIR", "media/covers")
    PHOTO_DIR: Path = BASE_DIR / os.getenv("PHOTO_DIR", "media/photos")

    THUMB_DIR: Path = BASE_DIR / os.getenv("THUMB_DIR", "media/thumbs")
    # 调试
    DEBUG: bool = _env_bool("DEBUG", False)

    @property
    def github_oauth_enabled(self) -> bool:
        """两个凭据都配了才启用 GitHub 登录"""
        return bool(self.GITHUB_CLIENT_ID and self.GITHUB_CLIENT_SECRET)

    @property
    def github_redirect_uri(self) -> str:
        return f"{self.BACKEND_URL}/api/comments/github/callback"

    def ensure_dirs(self):
        """确保媒体目录存在"""
        for d in (self.MEDIA_ROOT, self.MUSIC_DIR, self.COVER_DIR, self.PHOTO_DIR, self.THUMB_DIR,):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
