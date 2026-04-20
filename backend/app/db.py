from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from .config import settings

_connect_args = {}
if "sqlite" in settings.database_url:
    _connect_args["check_same_thread"] = False

async_engine = create_async_engine(settings.database_url, connect_args=_connect_args)

try:
    # Attach slow-query hook to the underlying sync engine. Keeps DB cost
    # observable in prod without depending on external APM.
    from .utils.db_observability import install_slow_query_logger

    install_slow_query_logger(async_engine.sync_engine)
except Exception:  # pragma: no cover - observability must never break boot
    import logging

    logging.getLogger("purvex.db").warning(
        "slow_query_logger_disabled", exc_info=True
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
