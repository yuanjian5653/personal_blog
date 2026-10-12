from datetime import datetime
from pydantic import BaseModel, Field


class LifePostRead(BaseModel):
    id: int
    content: str
    images: list[str] = []
    location: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class LifePostCreate(BaseModel):
    content: str = ""
    images: list[str] = []
    location: str | None = None


class LifePostUpdate(BaseModel):
    content: str | None = None
    images: list[str] | None = None
    location: str | None = None