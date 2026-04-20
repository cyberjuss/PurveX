"""Arq worker for PurveX background jobs.

Run with::

    arq app.worker.WorkerSettings

The worker picks up jobs enqueued via ``app.jobs.enqueue`` and executes them
with per-job timeouts and bounded retries. It is a separate process from the
API; both share the same database and Redis broker.
"""
from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

from arq.connections import RedisSettings

from .jobs.test_execution import run_test_execution
from .logging_config import configure_logging

logger = logging.getLogger("purvex.worker")


def _redis_settings() -> RedisSettings:
    url = os.getenv("REDIS_URL")
    if not url:
        raise RuntimeError(
            "REDIS_URL must be set to run the PurveX worker. "
            "Start Redis and export REDIS_URL=redis://host:port/0."
        )
    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        database=int(parsed.path.lstrip("/") or 0),
        password=parsed.password,
        ssl=parsed.scheme == "rediss",
    )


async def on_startup(ctx: dict) -> None:
    configure_logging()
    logger.info("PurveX arq worker starting")


async def on_shutdown(ctx: dict) -> None:
    logger.info("PurveX arq worker shutting down")


class WorkerSettings:
    """Arq settings. Extend ``functions`` as new jobs are added.

    ``redis_settings`` is resolved at import time — the worker process fails
    fast if ``REDIS_URL`` is not set, which is the correct behavior (a worker
    without a broker is useless).
    """

    functions = [run_test_execution]
    redis_settings = _redis_settings()
    on_startup = on_startup
    on_shutdown = on_shutdown
    # Default per-job timeout; individual jobs also self-enforce via wait_for.
    job_timeout = 60 * 60  # 1 hour hard ceiling
    max_tries = 3
    keep_result = 60 * 60  # retain result metadata 1h for debugging
    health_check_interval = 30
