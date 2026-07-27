"""Git audit mirror (SIEM → Git one-way write-back)

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-20

Adds:

* ``detection_git_mirrors`` — per-org repo that PurveX writes to so each
  SIEM-side change to a detection produces one git commit (audit trail).
* ``siem_connections.audit_mirror_id`` / ``audit_mirror_enabled`` —
  opt-in link from a SIEM connection to a mirror repo.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    # CORRECTNESS: on a fresh database, 0001_initial_schema's create_all()
    # already created this table (it creates everything in today's
    # models.py, not a frozen 0001-era snapshot) — guard against DuplicateTable.
    if "detection_git_mirrors" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "detection_git_mirrors",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "organization_id",
                sa.Integer(),
                sa.ForeignKey("organizations.id"),
                nullable=False,
            ),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("repo_url", sa.String(), nullable=False),
            sa.Column("branch", sa.String(), nullable=False, server_default="main"),
            sa.Column(
                "path_template",
                sa.String(),
                nullable=False,
                server_default="detections/{siem}/{technique_id}/{slug}.yml",
            ),
            sa.Column(
                "commit_author_name",
                sa.String(),
                nullable=False,
                server_default="PurveX Bot",
            ),
            sa.Column(
                "commit_author_email",
                sa.String(),
                nullable=False,
                server_default="purvex-bot@purvex.local",
            ),
            sa.Column(
                "write_mode",
                sa.String(),
                nullable=False,
                server_default="direct",
            ),
            sa.Column(
                "auth_type",
                sa.String(),
                nullable=False,
                server_default="none",
            ),
            sa.Column("auth_secret", sa.Text(), nullable=True),
            sa.Column(
                "enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column("last_mirrored_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_mirror_status", sa.String(), nullable=True),
            sa.Column("last_mirror_error", sa.Text(), nullable=True),
            sa.Column("last_commit_sha", sa.String(), nullable=True),
            sa.Column(
                "last_commits_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "last_files_written",
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

    mirror_ix = {ix["name"] for ix in sa.inspect(bind).get_indexes("detection_git_mirrors")}
    if "ix_detection_git_mirrors_organization_id" not in mirror_ix:
        op.create_index(
            "ix_detection_git_mirrors_organization_id",
            "detection_git_mirrors",
            ["organization_id"],
        )
    if "ix_detection_git_mirrors_org_mirrored" not in mirror_ix:
        op.create_index(
            "ix_detection_git_mirrors_org_mirrored",
            "detection_git_mirrors",
            ["organization_id", "last_mirrored_at"],
        )

    siem_columns = {col["name"] for col in sa.inspect(bind).get_columns("siem_connections")}
    new_siem_columns = [
        ("audit_mirror_id", sa.Column(
            "audit_mirror_id", sa.Integer(),
            sa.ForeignKey("detection_git_mirrors.id"), nullable=True,
        )),
        ("audit_mirror_enabled", sa.Column(
            "audit_mirror_enabled", sa.Boolean(),
            nullable=False, server_default=sa.text("false"),
        )),
    ]
    missing = [col for name, col in new_siem_columns if name not in siem_columns]
    if missing:
        with op.batch_alter_table("siem_connections") as batch:
            for col in missing:
                batch.add_column(col)

    siem_ix = {ix["name"] for ix in sa.inspect(bind).get_indexes("siem_connections")}
    if "ix_siem_connections_audit_mirror_id" not in siem_ix:
        op.create_index(
            "ix_siem_connections_audit_mirror_id",
            "siem_connections",
            ["audit_mirror_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    for name in (
        "ix_siem_connections_audit_mirror_id",
    ):
        try:
            op.drop_index(name, table_name="siem_connections")
        except Exception:
            pass
    with op.batch_alter_table("siem_connections") as batch:
        for col in ("audit_mirror_enabled", "audit_mirror_id"):
            try:
                batch.drop_column(col)
            except Exception:
                pass
    if "detection_git_mirrors" not in sa.inspect(bind).get_table_names():
        return
    for name in (
        "ix_detection_git_mirrors_org_mirrored",
        "ix_detection_git_mirrors_organization_id",
    ):
        try:
            op.drop_index(name, table_name="detection_git_mirrors")
        except Exception:
            pass
    op.drop_table("detection_git_mirrors")
