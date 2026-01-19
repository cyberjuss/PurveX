"""Quick script to check database state and diagnose login issues."""
import asyncio
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from app.db import async_sessionmaker
from app.models import User, Organization
from sqlalchemy import select

async def check_database():
    async with async_sessionmaker() as session:
        # Check organizations
        org_result = await session.execute(select(Organization))
        orgs = org_result.scalars().all()
        print(f"Organizations: {len(orgs)}")
        for org in orgs:
            print(f"  - {org.name} (id={org.id})")
        
        # Check users
        user_result = await session.execute(select(User))
        users = user_result.scalars().all()
        print(f"\nUsers: {len(users)}")
        for user in users:
            print(f"  - {user.email} (id={user.id}, admin={user.is_admin}, org_id={user.organization_id})")
            if user.organization_id is None:
                print(f"    ⚠ WARNING: User {user.email} has no organization_id!")

if __name__ == "__main__":
    asyncio.run(check_database())


























