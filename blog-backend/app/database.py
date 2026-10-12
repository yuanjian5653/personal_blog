from sqlmodel import SQLModel, Session, create_engine
from app.config import settings

# 创建引擎
# pool_pre_ping / pool_recycle 用于规避 MySQL 8 小时空闲断连（"MySQL server has
# gone away"）——连接前先探活，并每小时回收一次连接。
engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,          # 调试模式下打印 SQL
    pool_pre_ping=True,
    pool_recycle=3600,
)


def init_db():
    """按 SQLModel 模型创建所有表。

    注意：create_all 只建"不存在的表"，**不会修改已存在表的结构**。
    以后给模型加字段时，现有数据库不会自动同步——那种情况要么手动
    ALTER TABLE，要么引入迁移工具（本项目目前没有 Alembic）。
    """
    SQLModel.metadata.create_all(engine)


def get_session():
    """FastAPI 依赖注入用，每个请求一个 Session"""
    with Session(engine) as session:
        yield session