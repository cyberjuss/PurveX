"""Add jobs table for background worker tracking

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    # SECURITY/CORRECTNESS: 0001_initial_schema's create_all() creates every
    # table in *today's* models.py (not a frozen 0001-era snapshot), so on a
    # fresh database it already created "jobs" by the time this migration
    # runs. Guard against the resulting DuplicateTable error.
    if "jobs" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "jobs",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column(
                "organization_id",
                sa.Integer(),
                sa.ForeignKey("organizations.id"),
                nullable=True,
                index=True,
            ),
            sa.Column("job_type", sa.String(), nullable=False, index=True),
            sa.Column("resource_type", sa.String(), nullable=True),
            sa.Column("resource_id", sa.String(), nullable=True, index=True),
            sa.Column("status", sa.String(), nullable=False, server_default="pending", index=True),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("arq_job_id", sa.String(), nullable=True, index=True),
            sa.Column(
                "enqueued_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "jobs" in sa.inspect(bind).get_table_names():
        op.drop_table("jobs")
