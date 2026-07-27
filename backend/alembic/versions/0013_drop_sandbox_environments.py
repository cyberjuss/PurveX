"""Drop sandbox_environments — superseded by the environment-runner/agent model

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-27

``sandbox.py`` was an MVP stub ("attach real orchestrator later") that never
got a frontend caller — PurveX Lab provisioning is handled by the
environment-runner/agent registration flow instead. Dropping the table
along with the dead router/model/schema.

Idempotency note: same defensive pattern as 0009-0012 — tolerates re-runs
where the table is already gone.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sandbox_environments" in inspector.get_table_names():
        op.drop_table("sandbox_environments")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sandbox_environments" not in inspector.get_table_names():
        op.create_table(
            "sandbox_environments",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False, index=True),
            sa.Column("external_id", sa.String(), unique=True, nullable=False),
            sa.Column("display_name", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("size", sa.String(), nullable=True),
            sa.Column("provider", sa.String(), nullable=True),
            sa.Column("extra_metadata", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
