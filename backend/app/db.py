from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from .config import settings

# Use settings.database_url instead of settings.DATABASE_URL
async_engine = create_async_engine(
    settings.database_url, connect_args={"check_same_thread": False}
)

async_sessionmaker = async_sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=async_engine,
    class_=AsyncSession,
)

Base = declarative_base()


async def get_db():
    async with async_sessionmaker() as db:
        yield db
