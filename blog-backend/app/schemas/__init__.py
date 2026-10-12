from app.schemas.auth import AdminInfo, LoginRequest, LoginResponse
from app.schemas.music import (
    AddSongsRequest,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistRead,
    PlaylistUpdate,
    SongRead,
)
from app.schemas.album import (
    AlbumCreate,
    AlbumDetail,
    AlbumRead,
    AlbumUpdate,
    PhotoRead,
)
from app.schemas.article import (
    ArticleCreate,
    ArticleListItem,
    ArticleRead,
    ArticleUpdate,
)
from app.schemas.essay import (
    EssayCreate,
    EssayRead,
    EssayUpdate,
)

__all__ = [
    "AdminInfo", "LoginRequest", "LoginResponse",
    "SongRead", "PlaylistRead", "PlaylistDetail",
    "PlaylistCreate", "PlaylistUpdate", "AddSongsRequest",
    "AlbumCreate", "AlbumDetail", "AlbumRead", "AlbumUpdate",
    "PhotoRead",
    "ArticleCreate", "ArticleListItem", "ArticleRead", "ArticleUpdate",
    "EssayCreate", "EssayRead", "EssayUpdate",
]