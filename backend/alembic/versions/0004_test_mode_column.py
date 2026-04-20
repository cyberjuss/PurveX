"""Add explicit run-mode column to tests

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-19

The ``mode`` column captures the user's intent for a test run
(``DETECTION_VALIDATION`` | ``ALERT_CHECK`` | ``TELEMETRY_CHECK``).

Before this migration the value was passed by the UI but discarded server-side
(only mentioned in audit logs). Persisting it lets the runner branch into
``validate_telemetry_for_test`` for explicit telemetry-readiness runs and lets
reporting filter / group by run intent.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("tests")}
    if "mode" not in existing:
        op.add_column(
            "tests",
            sa.Column(
                "mode",
                sa.String(),
                nullable=False,
                server_default="DETECTION_VALIDATION",
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("tests")}
    if "mode" in existing:
        op.drop_column("tests", "mode")
