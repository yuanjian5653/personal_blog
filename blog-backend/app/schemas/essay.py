from datetime import datetime
from pydantic import BaseModel, Field


class EssayRead(BaseModel):
    id: int
    title: str
    content: str
    excerpt: str | None = None
    images: list[str] = []
    likes: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EssayCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = ""
    excerpt: str | None = None
    images: list[str] = []


class EssayUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    excerpt: str | None = None
    images: list[str] | None = None