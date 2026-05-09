"""Pin SSH runner host keys

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-22

Idempotency note: in development, the column is sometimes added by
``Base.metadata.create_all()`` on first app start before alembic catches
up — leaving alembic_version at 0008 while the schema is partially at
0009. This migration tolerates that state by inspecting the live schema
before issuing the ALTER.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("environment_runner_configs")}
    if "ssh_host_key_sha256" in columns:
        return  # already present (likely via create_all on first boot)
    with op.batch_alter_table("environment_runner_configs") as batch:
        batch.add_column(sa.Column("ssh_host_key_sha256", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("environment_runner_configs")}
    if "ssh_host_key_sha256" not in columns:
        return
    with op.batch_alter_table("environment_runner_configs") as batch:
        batch.drop_column("ssh_host_key_sha256")
