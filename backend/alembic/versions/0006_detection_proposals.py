"""Detection proposals (AI remediation guardrails)

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-19

Adds the ``detection_proposals`` table that backs the Sprint 2 guardrail flow:
AI suggestions land here as pending rows and only reach the Detection model
through an explicit human approval. Designed to be reused in Sprint 3 by
Detection-as-Code for git PR proposals (``proposed_by_kind="git"``).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "detection_proposals",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("detection_id", sa.String(), sa.ForeignKey("detections.id"), nullable=True),
        sa.Column("proposed_by_kind", sa.String(), nullable=False, server_default="ai"),
        sa.Column("proposed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("proposed_by_label", sa.String(), nullable=False, server_default="AI Assistant"),
        sa.Column("action", sa.String(), nullable=False, server_default="update"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("target_fields", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("current_snapshot", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_proposals_org_status_created",
        "detection_proposals",
        ["organization_id", "status", "created_at"],
    )
    op.create_index(
        "ix_proposals_detection_status",
        "detection_proposals",
        ["detection_id", "status"],
    )
    op.create_index(
        "ix_detection_proposals_organization_id",
        "detection_proposals",
        ["organization_id"],
    )


def downgrade() -> None:
    for name in (
        "ix_detection_proposals_organization_id",
        "ix_proposals_detection_status",
        "ix_proposals_org_status_created",
    ):
        try:
            op.drop_index(name, table_name="detection_proposals")
        except Exception:
            pass
    op.drop_table("detection_proposals")
