"""Add notifications table — persisted platform inbox

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-27

Previously the "platform" notification category (new runner connected,
runner gone stale, proposal outcomes) lived only in browser localStorage —
it didn't survive a refresh and wasn't shared across analysts on the same
org. This gives it a real, org-scoped, queryable home.

Idempotency note: same defensive pattern as 0009-0013 — tolerates re-runs
where the table already exists.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "notifications" in inspector.get_table_names():
        return

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False, index=True),
        sa.Column("type", sa.String(), nullable=False, server_default="platform"),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("action_url", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="info"),
        sa.Column("source_type", sa.String(), nullable=True),
        sa.Column("source_id", sa.String(), nullable=True),
        sa.Column("extra_metadata", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_notifications_org_source",
        "notifications",
        ["organization_id", "source_type", "source_id"],
    )
    op.create_index(
        "ix_notifications_org_created_at",
        "notifications",
        ["organization_id", "created_at"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "notifications" in inspector.get_table_names():
        op.drop_table("notifications")
