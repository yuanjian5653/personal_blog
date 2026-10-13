from pydantic import BaseModel


class SiteConfigUpdate(BaseModel):
    """批量更新配置的请求体"""
    configs: dict[str, str]


class SiteConfigResponse(BaseModel):
    """返回所有配置"""
    configs: dict[str, str]


class SiteStats(BaseModel):
    """站点实时统计（首页个人卡片用）

    这些数字由数据库实时统计得出，不再依赖后台手填的 author_stats_* 配置，
    避免出现「配置里写 6 篇、实际只有 4 篇」的不一致。
    """
    articles: int      # 已发布文章数
    essays: int        # 随笔数
    photos: int        # 照片数
    albums: int        # 相册数
    songs: int         # 本地歌曲数
