"""Add user invite flow: pending-activation flag + invite tokens table

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-24

Adds ``users.is_pending_activation`` (defaults False so every existing
user stays unaffected) and a ``user_invite_tokens`` table shaped like
``password_reset_tokens`` but kept separate — invites and resets have
different expiry windows and semantics, and a token minted for one
should never be replayable as the other.

Idempotency note: same defensive pattern as 0009-0011 — tolerates re-runs
where the column or table already exists.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = {col["name"] for col in inspector.get_columns("users")}
    if "is_pending_activation" not in columns:
        with op.batch_alter_table("users") as batch:
            batch.add_column(
                sa.Column(
                    "is_pending_activation",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )

    if "user_invite_tokens" not in inspector.get_table_names():
        op.create_table(
            "user_invite_tokens",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("invited_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("jti", sa.String(), unique=True, index=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "user_invite_tokens" in inspector.get_table_names():
        op.drop_table("user_invite_tokens")

    columns = {col["name"] for col in inspector.get_columns("users")}
    if "is_pending_activation" in columns:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("is_pending_activation")
