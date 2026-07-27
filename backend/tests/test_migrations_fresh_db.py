"""Regression test for the 2026-07-27 fix: running `alembic upgrade head`
against a genuinely empty database used to crash with DuplicateTable,
because 0001_initial_schema's `Base.metadata.create_all()` creates every
table in *today's* models.py (not a frozen 0001-era snapshot), so several
later migrations (0002, 0006, 0007, 0008) that unconditionally
`op.create_table(...)`/`add_column(...)` collided with what 0001 already
created.

This matters because `main.py::create_db_and_tables` skips `create_all()`
entirely in managed environments (beta/staging/prod — see
`_is_managed_schema_env`) and instead requires the schema to already be
fully migrated via `alembic upgrade head` run as a separate deploy step.
A fresh managed-environment install was therefore guaranteed to fail.

Runs against a real file-based SQLite DB (not `:memory:` — alembic opens
its own connection separate from any fixture-held one, so in-memory
wouldn't see the same database) since that's enough to reproduce the
DuplicateTable class of bug without requiring Postgres in CI.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic_config(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path.as_posix()}")
    return cfg


def test_upgrade_head_on_fresh_database_does_not_raise():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "fresh.db"
        cfg = _alembic_config(db_path)
        # Would raise sqlalchemy.exc.OperationalError/ProgrammingError
        # (duplicate table) before the fix.
        command.upgrade(cfg, "head")


def test_upgrade_head_then_downgrade_to_base_round_trips():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "fresh.db"
        cfg = _alembic_config(db_path)
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")
        # And back up again — proves downgrade didn't leave partial state
        # that breaks a subsequent upgrade.
        command.upgrade(cfg, "head")
