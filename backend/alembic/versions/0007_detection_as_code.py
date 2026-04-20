"""Detection-as-Code (Sprint 3)

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-19

Adds:

* ``detection_sources`` — per-org git repo configuration that drives
  upstream sync of detection rules.
* ``detections.detection_source_id`` / ``source_path`` / ``source_commit_sha``
  columns — git provenance alongside the existing SIEM provenance.
* Extends ``detections.source`` semantics to include ``"git"``.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "detection_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False, server_default="git"),
        sa.Column("repo_url", sa.String(), nullable=False),
        sa.Column("branch", sa.String(), nullable=False, server_default="main"),
        sa.Column(
            "path_glob",
            sa.String(),
            nullable=False,
            server_default="detections/**/*.yml",
        ),
        sa.Column("auth_type", sa.String(), nullable=False, server_default="none"),
        sa.Column("auth_secret", sa.Text(), nullable=True),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.String(), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("last_commit_sha", sa.String(), nullable=True),
        sa.Column(
            "last_created_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "last_updated_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "last_proposals_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "last_skipped_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_detection_sources_organization_id",
        "detection_sources",
        ["organization_id"],
    )
    op.create_index(
        "ix_detection_sources_org_synced",
        "detection_sources",
        ["organization_id", "last_synced_at"],
    )

    # Extend the detections table with git provenance columns.
    with op.batch_alter_table("detections") as batch:
        batch.add_column(
            sa.Column(
                "detection_source_id",
                sa.Integer(),
                sa.ForeignKey("detection_sources.id"),
                nullable=True,
            )
        )
        batch.add_column(sa.Column("source_path", sa.String(), nullable=True))
        batch.add_column(
            sa.Column("source_commit_sha", sa.String(), nullable=True)
        )
        batch.add_column(sa.Column("source_payload", sa.Text(), nullable=True))
    op.create_index(
        "ix_detections_detection_source_id",
        "detections",
        ["detection_source_id"],
    )


def downgrade() -> None:
    try:
        op.drop_index("ix_detections_detection_source_id", table_name="detections")
    except Exception:
        pass
    with op.batch_alter_table("detections") as batch:
        for col in (
            "source_payload",
            "source_commit_sha",
            "source_path",
            "detection_source_id",
        ):
            try:
                batch.drop_column(col)
            except Exception:
                pass
    for name in (
        "ix_detection_sources_org_synced",
        "ix_detection_sources_organization_id",
    ):
        try:
            op.drop_index(name, table_name="detection_sources")
        except Exception:
            pass
    op.drop_table("detection_sources")
