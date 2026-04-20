"""SQLAlchemy slow-query logger.

Registers `before_cursor_execute` / `after_cursor_execute` event hooks on the
engine's underlying sync connection and logs any statement whose wall-clock
execution exceeds ``SLOW_QUERY_THRESHOLD_MS`` (configurable).

The hook is deliberately defensive:

* It only logs — it never raises, so a bad statement can never break a request
  because of observability.
* It truncates the SQL to a sane length so we don't dump a 100KB IN-clause into
  the log stream.
* It respects the ``SLOW_QUERY_THRESHOLD_MS=0`` kill-switch so noisy
  environments (or tests) can opt out.
"""
from __future__ import annotations

import logging
import time

from sqlalchemy import event
from sqlalchemy.engine import Engine

from ..config import settings

logger = logging.getLogger("purvex.db.slow_query")

_MAX_SQL_CHARS = 2000


def install_slow_query_logger(engine: Engine | None = None) -> None:
    """Attach slow-query hooks. Safe to call multiple times (idempotent)."""
    if getattr(install_slow_query_logger, "_installed", False):
        return
    install_slow_query_logger._installed = True  # type: ignore[attr-defined]

    target: type[Engine] | Engine = engine if engine is not None else Engine

    @event.listens_for(target, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: D401
        context._purvex_slow_start = time.perf_counter()

    @event.listens_for(target, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):
        threshold_ms = int(getattr(settings, "SLOW_QUERY_THRESHOLD_MS", 0) or 0)
        if threshold_ms <= 0:
            return
        start = getattr(context, "_purvex_slow_start", None)
        if start is None:
            return
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        if elapsed_ms < threshold_ms:
            return

        snippet = (statement or "")[:_MAX_SQL_CHARS]
        logger.warning(
            "slow_query elapsed_ms=%.1f threshold_ms=%d sql=%s",
            elapsed_ms,
            threshold_ms,
            snippet.replace("\n", " "),
        )
