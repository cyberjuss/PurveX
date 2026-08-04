"""Add server-generated SSH keypair columns for automated runner provisioning

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-04

The installer-script registration flow previously left a runner "online"
(heartbeating) with no way for PurveX to actually SSH into it — auth_method
could be "key" with no key material anywhere, and no ssh_host_key_sha256,
so every atomic-test run against such a runner failed at execution time.

This adds:
- environment_runner_configs.ssh_public_key / ssh_private_key_encrypted:
  populated from the matching agent_registration_tokens row when a runner
  is created via a registration token. Manual "Manual SSH" entries keep
  using key_path (a key already on the PurveX server's filesystem) and
  leave these columns null.
- agent_registration_tokens.ssh_public_key / ssh_private_key_encrypted:
  the keypair minted at token-generation time, embedded in the generated
  installer script so it can provision its own authorized_keys entry.

Idempotency note: same defensive pattern as 0009-0015.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    runner_columns = {col["name"] for col in sa.inspect(bind).get_columns("environment_runner_configs")}
    with op.batch_alter_table("environment_runner_configs") as batch:
        if "ssh_public_key" not in runner_columns:
            batch.add_column(sa.Column("ssh_public_key", sa.Text(), nullable=True))
        if "ssh_private_key_encrypted" not in runner_columns:
            batch.add_column(sa.Column("ssh_private_key_encrypted", sa.Text(), nullable=True))

    token_columns = {col["name"] for col in sa.inspect(bind).get_columns("agent_registration_tokens")}
    with op.batch_alter_table("agent_registration_tokens") as batch:
        if "ssh_public_key" not in token_columns:
            batch.add_column(sa.Column("ssh_public_key", sa.Text(), nullable=True))
        if "ssh_private_key_encrypted" not in token_columns:
            batch.add_column(sa.Column("ssh_private_key_encrypted", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()

    runner_columns = {col["name"] for col in sa.inspect(bind).get_columns("environment_runner_configs")}
    with op.batch_alter_table("environment_runner_configs") as batch:
        if "ssh_private_key_encrypted" in runner_columns:
            batch.drop_column("ssh_private_key_encrypted")
        if "ssh_public_key" in runner_columns:
            batch.drop_column("ssh_public_key")

    token_columns = {col["name"] for col in sa.inspect(bind).get_columns("agent_registration_tokens")}
    with op.batch_alter_table("agent_registration_tokens") as batch:
        if "ssh_private_key_encrypted" in token_columns:
            batch.drop_column("ssh_private_key_encrypted")
        if "ssh_public_key" in token_columns:
            batch.drop_column("ssh_public_key")
