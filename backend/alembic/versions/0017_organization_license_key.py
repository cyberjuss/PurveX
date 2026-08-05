"""Add organizations.license_key_encrypted for in-app license key entry

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-04

Previously the only way to apply a paid license was hand-editing the
PURVEX_LICENSE_KEY env var and restarting the server -- no in-app path
existed at all. This adds a per-organization encrypted column so an
admin can paste a key into Settings -> License and have it take effect
immediately, with the env var remaining as a fallback for existing
deployments that already set it that way.

Idempotency note: same defensive pattern as 0009-0016.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    org_columns = {col["name"] for col in sa.inspect(bind).get_columns("organizations")}
    with op.batch_alter_table("organizations") as batch:
        if "license_key_encrypted" not in org_columns:
            batch.add_column(sa.Column("license_key_encrypted", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()

    org_columns = {col["name"] for col in sa.inspect(bind).get_columns("organizations")}
    with op.batch_alter_table("organizations") as batch:
        if "license_key_encrypted" in org_columns:
            batch.drop_column("license_key_encrypted")
