from datetime import datetime

from sqlalchemy import JSON
from sqlmodel import SQLModel, Field, Column

from app.models._base import utcnow


class OperationLog(SQLModel, table=True):
    __tablename__ = "operation_logs"

    id: int | None = Field(default=None, primary_key=True)
    admin_id: int = Field(foreign_key="admin.id", index=True)
    action: str = Field(max_length=50)          # create / update / delete
    target_type: str = Field(max_length=50)     # song / post / photo / config
    target_id: int | None = Field(default=None)
    changes: dict | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow, index=True)
