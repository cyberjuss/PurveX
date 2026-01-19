"""
One-off helper to backfill organization_id for existing rows.

Usage (from backend/ directory):

    python -m scripts.backfill_org_ids

This script is SAFE to run multiple times. It will:
  - Ensure at least one Organization exists (creates "Default Org" if not).
  - Assign that org_id to any Users without organization_id.
  - Assign that org_id to any Detections / Tests / TestArtifacts without organization_id.

After running this in dev, you can tighten the SQLAlchemy models and DB schema
to make organization_id non-nullable for these tables.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select, update

from app.db import async_sessionmaker
from app import models


async def main() -> None:
    async with async_sessionmaker() as session:
        # 1) Ensure there is at least one organization.
        result = await session.execute(select(models.Organization).limit(1))
        org = result.scalar_one_or_none()
        if org is None:
            org = models.Organization(name="Default Org")
            session.add(org)
            await session.commit()
            await session.refresh(org)
        org_id = org.id

        # 2) Backfill users without organization_id.
        await session.execute(
            update(models.User)
            .where(models.User.organization_id.is_(None))
            .values(organization_id=org_id)
        )

        # 3) Backfill detections/tests/artifacts without organization_id.
        await session.execute(
            update(models.Detection)
            .where(models.Detection.organization_id.is_(None))
            .values(organization_id=org_id)
        )
        await session.execute(
            update(models.Test)
            .where(models.Test.organization_id.is_(None))
            .values(organization_id=org_id)
        )
        await session.execute(
            update(models.TestArtifact)
            .where(models.TestArtifact.organization_id.is_(None))
            .values(organization_id=org_id)
        )

        await session.commit()
        print(f"[PurveX] Backfilled organization_id={org_id} for users, detections, tests, and artifacts.")


if __name__ == "__main__":
    asyncio.run(main())


