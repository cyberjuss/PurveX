"""Add users.token_valid_after for session revocation on password change

Revision ID: 0015
Revises: 0014
Create Date: 2026-07-28

JWTs are stateless — an admin-forced or self-service password reset
doesn't by itself invalidate any already-issued token for that user, so
if an account was compromised and the password reset specifically
because of that, the attacker's existing session kept working until it
naturally expired. get_current_user now rejects any token whose `iat`
predates this timestamp; set_user_password and confirm_password_reset
both set it to now() on every password change.

Idempotency note: same defensive pattern as 0009-0014.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("users")}
    if "token_valid_after" not in columns:
        with op.batch_alter_table("users") as batch:
            batch.add_column(
                sa.Column("token_valid_after", sa.DateTime(timezone=True), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("users")}
    if "token_valid_after" in columns:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("token_valid_after")
