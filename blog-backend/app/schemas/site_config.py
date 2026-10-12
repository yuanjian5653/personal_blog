from pydantic import BaseModel


class SiteConfigUpdate(BaseModel):
    """批量更新配置的请求体"""
    configs: dict[str, str]


class SiteConfigResponse(BaseModel):
    """返回所有配置"""
    configs: dict[str, str]