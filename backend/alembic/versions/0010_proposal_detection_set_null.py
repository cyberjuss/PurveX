"""Set detection_proposals.detection_id ON DELETE SET NULL

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-26

Without this migration, deleting a Detection that has any historical
proposals fails on Postgres with a foreign-key violation (and silently
orphans rows on dev SQLite). The application-side service layer also
supersedes pending proposals when their target is removed, but the FK
relax is needed so the parent delete can complete in the same
transaction.

Idempotency note: skip the swap if the FK already has the right
ondelete behaviour. Lets the migration tolerate environments where
``Base.metadata.create_all()`` already produced the FK with the desired
options before alembic ran.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _detection_fk_already_set_null(inspector: sa.engine.Inspector) -> bool:
    fks = inspector.get_foreign_keys("detection_proposals")
    for fk in fks:
        if fk.get("constrained_columns") != ["detection_id"]:
            continue
        ondelete = ((fk.get("options") or {}).get("ondelete") or "").upper().replace(" ", "")
        if ondelete == "SETNULL":
            return True
    return False


def upgrade() -> None:
    bind = op.get_bind()
    # SQLite doesn't preserve FK constraint names and (without an explicit
    # PRAGMA foreign_keys=ON) doesn't enforce them strictly anyway. The
    # model already declares ``ondelete="SET NULL"`` so create_all() on a
    # fresh dev DB produces the right shape — alembic doesn't need to
    # rewrite it. The ``ON DELETE SET NULL`` matters for Postgres prod,
    # where FK enforcement is strict and the model alone isn't enough.
    if bind.dialect.name == "sqlite":
        return
    inspector = sa.inspect(bind)
    if _detection_fk_already_set_null(inspector):
        return
    with op.batch_alter_table("detection_proposals") as batch:
        batch.drop_constraint(
            "detection_proposals_detection_id_fkey", type_="foreignkey"
        )
        batch.create_foreign_key(
            "detection_proposals_detection_id_fkey",
            "detections",
            ["detection_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return
    inspector = sa.inspect(bind)
    if not _detection_fk_already_set_null(inspector):
        return
    with op.batch_alter_table("detection_proposals") as batch:
        batch.drop_constraint(
            "detection_proposals_detection_id_fkey", type_="foreignkey"
        )
        batch.create_foreign_key(
            "detection_proposals_detection_id_fkey",
            "detections",
            ["detection_id"],
            ["id"],
        )
