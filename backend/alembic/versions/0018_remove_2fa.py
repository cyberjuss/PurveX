"""Remove two-factor authentication columns from users

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-05

2FA was fully built on the backend (TOTP codes, backup codes, the login
challenge flow) but never had a self-service enrollment UI -- the only way
to turn it on for an account was a direct API/DB call, so in practice no
real account used it. Removing it outright rather than leaving half-built
security surface area (an extra auth branch, an extra token type, three
columns of secret material) sitting unused.

Idempotency note: same defensive pattern as 0009-0017.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    user_columns = {col["name"] for col in sa.inspect(bind).get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "two_factor_backup_codes" in user_columns:
            batch.drop_column("two_factor_backup_codes")
        if "two_factor_secret" in user_columns:
            batch.drop_column("two_factor_secret")
        if "two_factor_enabled" in user_columns:
            batch.drop_column("two_factor_enabled")


def downgrade() -> None:
    bind = op.get_bind()

    user_columns = {col["name"] for col in sa.inspect(bind).get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "two_factor_enabled" not in user_columns:
            batch.add_column(sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "two_factor_secret" not in user_columns:
            batch.add_column(sa.Column("two_factor_secret", sa.String(), nullable=True))
        if "two_factor_backup_codes" not in user_columns:
            batch.add_column(sa.Column("two_factor_backup_codes", sa.Text(), nullable=True))
