"""Composite indexes for high-traffic query paths

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-19

Backs the dashboard, tests list, detection detail, job queue and audit views
with composite indexes so they stay O(log n) as tenants grow. The migration
is idempotent so rerunning or partially-applied states don't fail.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_indexes(bind, table: str) -> set[str]:
    try:
        return {ix["name"] for ix in sa.inspect(bind).get_indexes(table)}
    except Exception:
        return set()


def upgrade() -> None:
    bind = op.get_bind()

    tests_ix = _existing_indexes(bind, "tests")
    if "ix_tests_org_started_at" not in tests_ix:
        op.create_index(
            "ix_tests_org_started_at",
            "tests",
            ["organization_id", "started_at"],
        )
    if "ix_tests_detection_mode_started" not in tests_ix:
        op.create_index(
            "ix_tests_detection_mode_started",
            "tests",
            ["detection_id", "mode", "started_at"],
        )
    if "ix_tests_org_status" not in tests_ix:
        op.create_index(
            "ix_tests_org_status",
            "tests",
            ["organization_id", "status"],
        )

    audit_ix = _existing_indexes(bind, "audit_events")
    if "ix_audit_events_created_at" not in audit_ix:
        op.create_index(
            "ix_audit_events_created_at",
            "audit_events",
            ["created_at"],
        )
    if "ix_audit_events_action_created_at" not in audit_ix:
        op.create_index(
            "ix_audit_events_action_created_at",
            "audit_events",
            ["action", "created_at"],
        )

    job_ix = _existing_indexes(bind, "jobs")
    if "ix_jobs_status_enqueued_at" not in job_ix:
        op.create_index(
            "ix_jobs_status_enqueued_at",
            "jobs",
            ["status", "enqueued_at"],
        )
    if "ix_jobs_org_enqueued_at" not in job_ix:
        op.create_index(
            "ix_jobs_org_enqueued_at",
            "jobs",
            ["organization_id", "enqueued_at"],
        )


def downgrade() -> None:
    for name, table in [
        ("ix_jobs_org_enqueued_at", "jobs"),
        ("ix_jobs_status_enqueued_at", "jobs"),
        ("ix_audit_events_action_created_at", "audit_events"),
        ("ix_audit_events_created_at", "audit_events"),
        ("ix_tests_org_status", "tests"),
        ("ix_tests_detection_mode_started", "tests"),
        ("ix_tests_org_started_at", "tests"),
    ]:
        try:
            op.drop_index(name, table_name=table)
        except Exception:
            pass
