"""Mirror scheduler — periodic SIEM sync + git mirror push.

Iterates every ``SIEMConnection`` with ``audit_mirror_enabled=True``, runs
the detection sync, then publishes any mirrorable events to the linked
``DetectionGitMirror`` repo. One worker task per process, gated by the
``PURVEX_MIRROR_SCHEDULER_ENABLED`` env flag.

Failure policy
--------------
Per-connection failures never abort the whole sweep — each connection is
wrapped in its own try/except and its error is recorded on the
connection/mirror telemetry fields. We never re-raise back to the worker
loop, so a single broken SIEM credential can't wedge the scheduler.

Cadence
-------
Interval is configurable via ``PURVEX_MIRROR_SCHEDULER_INTERVAL_SEC`` and
defaults to 900s (15 min). SIEM sync is idempotent, so running slightly
more often than needed is harmless.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Optional

from sqlalchemy import select

from ..db import async_sessionmaker
from .. import models
from . import git_writeback
from .detection_sync import sync_connection

logger = logging.getLogger("purvex.services.mirror_scheduler")

_scheduler_task: Optional[asyncio.Task] = None
_stop_event: Optional[asyncio.Event] = None

# Per-connection asyncio locks. A second sweep tick that arrives before the
# previous one finished its work for a given connection will wait here
# instead of double-cloning, double-committing, and racing the writeback
# push. Single-replica beta installs only need an in-process lock; a
# multi-replica deployment will need a Redis/Postgres advisory lock —
# tracked in the production-readiness checklist.
_connection_locks: Dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)


def _lock_for_connection(connection_id: int) -> asyncio.Lock:
    return _connection_locks[connection_id]


def _default_interval_seconds() -> int:
    raw = os.environ.get("PURVEX_MIRROR_SCHEDULER_INTERVAL_SEC", "900")
    try:
        value = int(raw)
    except ValueError:
        return 900
    return max(60, value)


def _enabled() -> bool:
    return os.environ.get("PURVEX_MIRROR_SCHEDULER_ENABLED", "true").lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


async def _sweep_once() -> None:
    """One full pass: for every SIEM connection with mirror enabled, sync
    it and push any changes to the linked mirror.

    Each connection gets its own AsyncSession (scoped to its work) so a
    failure can't leak orphan state into the next connection's sync.
    """
    async with async_sessionmaker() as session:
        res = await session.execute(
            select(models.SIEMConnection).where(
                models.SIEMConnection.audit_mirror_enabled.is_(True),
                models.SIEMConnection.audit_mirror_id.isnot(None),
            )
        )
        connections = list(res.scalars().all())

    logger.info(
        "mirror scheduler sweep: %d connection(s) with mirror enabled",
        len(connections),
    )

    for conn in connections:
        try:
            # Per-connection lock prevents two overlapping sweeps from
            # syncing + writing back to the same mirror simultaneously.
            # ``acquire(... timeout=0)`` would skip; we'd rather wait so
            # the next tick still completes the work — interval is 15min
            # by default, plenty of headroom.
            lock = _lock_for_connection(conn.id)
            if lock.locked():
                logger.info(
                    "mirror sweep: connection %s already in flight, skipping this tick",
                    conn.id,
                )
                continue
            async with lock, async_sessionmaker() as session:
                # Reload the connection in this session so it's attached
                # and we can commit updates to its telemetry fields.
                live_conn = await session.get(models.SIEMConnection, conn.id)
                if live_conn is None:
                    continue
                report = await sync_connection(session, live_conn)

                if not any(e.action != "skip" for e in report.events):
                    logger.debug(
                        "mirror sweep: no changes for SIEM connection %s",
                        live_conn.id,
                    )
                    continue

                mirror = await session.get(
                    models.DetectionGitMirror, live_conn.audit_mirror_id
                )
                if mirror is None or not mirror.enabled:
                    logger.warning(
                        "mirror sweep: mirror %s missing/disabled for connection %s",
                        live_conn.audit_mirror_id,
                        live_conn.id,
                    )
                    continue
                outcome = await git_writeback.publish_events(
                    session, mirror, live_conn, report.events
                )
                await session.commit()
                logger.info(
                    "mirror sweep: connection=%s commit=%s files=%d errors=%d",
                    live_conn.id,
                    outcome.commit_sha,
                    outcome.files_written,
                    len(outcome.errors),
                )
        except Exception:  # noqa: BLE001 - per-connection isolation
            logger.exception(
                "mirror sweep failed for SIEM connection %s", conn.id
            )


async def _scheduler_loop(interval_seconds: int) -> None:
    assert _stop_event is not None
    logger.info(
        "mirror scheduler started (interval=%ss)", interval_seconds
    )
    try:
        while not _stop_event.is_set():
            started_at = datetime.now(timezone.utc)
            try:
                await _sweep_once()
            except Exception:  # pragma: no cover - defensive
                logger.exception("mirror scheduler sweep failed")
            elapsed = (
                datetime.now(timezone.utc) - started_at
            ).total_seconds()
            # Clamp wait so a long sweep doesn't starve the next one but
            # we still respect the configured cadence.
            wait_for = max(1.0, interval_seconds - elapsed)
            try:
                await asyncio.wait_for(_stop_event.wait(), timeout=wait_for)
            except asyncio.TimeoutError:
                continue
    except asyncio.CancelledError:
        raise
    finally:
        logger.info("mirror scheduler stopped")


def start_mirror_scheduler(*, interval_seconds: Optional[int] = None) -> None:
    """Idempotent start. No-op if already running or disabled via env."""
    global _scheduler_task, _stop_event
    if not _enabled():
        logger.info("mirror scheduler disabled via env")
        return
    if _scheduler_task is not None and not _scheduler_task.done():
        return
    interval = interval_seconds or _default_interval_seconds()
    _stop_event = asyncio.Event()
    _scheduler_task = asyncio.create_task(_scheduler_loop(interval))


async def stop_mirror_scheduler() -> None:
    """Idempotent stop. Safe to call from multiple shutdown paths."""
    global _scheduler_task, _stop_event
    if _scheduler_task is None:
        return
    if _stop_event is not None:
        _stop_event.set()
    task = _scheduler_task
    _scheduler_task = None
    _stop_event = None
    try:
        await asyncio.wait_for(task, timeout=10.0)
    except asyncio.TimeoutError:
        task.cancel()
        try:
            await task
        except Exception:  # pragma: no cover
            pass
