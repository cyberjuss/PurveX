"""Store selected Atomic test metadata on test runs

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("tests")}
    if "atomic_test_id" not in existing:
        op.add_column("tests", sa.Column("atomic_test_id", sa.String(), nullable=True))
    if "atomic_test_name" not in existing:
        op.add_column("tests", sa.Column("atomic_test_name", sa.String(), nullable=True))
    if "atomic_test_number" not in existing:
        op.add_column("tests", sa.Column("atomic_test_number", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("tests")}
    if "atomic_test_number" in existing:
        op.drop_column("tests", "atomic_test_number")
    if "atomic_test_name" in existing:
        op.drop_column("tests", "atomic_test_name")
    if "atomic_test_id" in existing:
        op.drop_column("tests", "atomic_test_id")
