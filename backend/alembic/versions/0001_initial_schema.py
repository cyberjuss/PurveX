"""Initial schema baseline

This is a baseline migration. Running `alembic upgrade head` on an empty
database will create all tables from the current SQLAlchemy metadata. On
existing databases, run `alembic stamp head` to mark this revision as
applied without re-running DDL.

Revision ID: 0001
Revises:
Create Date: 2026-04-19
"""
from typing import Sequence, Union

from alembic import op

from app.db import Base
from app import models  # noqa: F401 — register models with Base.metadata


revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
