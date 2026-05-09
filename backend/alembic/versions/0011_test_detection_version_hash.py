"""Add detection_version_hash snapshot to tests

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-08

Stores a SHA-256 hash of the detection's rule fields at the moment a
Test row is created. This is the primary key for grouping validation
runs by rule version, so the UI can answer "did my last edit hurt?"
without coupling to upstream-drift fields like ``detections.content_hash``
(which represents SIEM/git source-of-truth, not local rule state).

Pre-existing test rows stay NULL and surface as "Legacy" in the UI —
no backfill, since we can't know what the rule looked like at the time
those tests ran.

The composite index supports the per-detection KPI query:
``GROUP BY detection_id, detection_version_hash`` ordered by
``MIN(started_at)`` to assign v1/v2/... labels.

Idempotency note: tolerates re-runs where the column or index is
already present. Same defensive pattern as 0009/0010 — protects against
environments where ``Base.metadata.create_all()`` got ahead of alembic.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = {col["name"] for col in inspector.get_columns("tests")}
    if "detection_version_hash" not in columns:
        with op.batch_alter_table("tests") as batch:
            batch.add_column(
                sa.Column("detection_version_hash", sa.String(length=64), nullable=True)
            )

    indexes = {idx["name"] for idx in inspector.get_indexes("tests")}
    if "ix_tests_detection_version" not in indexes:
        op.create_index(
            "ix_tests_detection_version",
            "tests",
            ["detection_id", "detection_version_hash", "started_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    indexes = {idx["name"] for idx in inspector.get_indexes("tests")}
    if "ix_tests_detection_version" in indexes:
        op.drop_index("ix_tests_detection_version", table_name="tests")

    columns = {col["name"] for col in inspector.get_columns("tests")}
    if "detection_version_hash" in columns:
        with op.batch_alter_table("tests") as batch:
            batch.drop_column("detection_version_hash")
