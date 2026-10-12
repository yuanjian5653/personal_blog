from datetime import datetime

from sqlalchemy import Text
from sqlmodel import SQLModel, Field, Column

from app.models._base import utcnow


class SiteConfig(SQLModel, table=True):
    __tablename__ = "site_config"

    id: int | None = Field(default=None, primary_key=True)
    config_key: str = Field(unique=True, index=True, max_length=100)
    config_value: str = Field(default="", sa_column=Column(Text))
    updated_at: datetime = Field(default_factory=utcnow)
