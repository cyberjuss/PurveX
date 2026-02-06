import argparse
import asyncio
import getpass

from sqlalchemy import select

from app import models
from app.config import settings
from app.db import async_sessionmaker
from app.security import hash_password, verify_password


async def ensure_org(session) -> models.Organization:
    result = await session.execute(select(models.Organization))
    org = result.scalars().first()
    if org:
        return org
    org = models.Organization(
        name=settings.ORGANIZATION_NAME,
        primary_contact_email=settings.PRIMARY_CONTACT_EMAIL,
        timezone=settings.DEFAULT_TIMEZONE,
        locale=settings.DEFAULT_LOCALE,
        default_environment_names=settings.DEFAULT_ENVIRONMENT_NAMES,
        compliance_mode_flags=settings.COMPLIANCE_MODE_FLAGS,
    )
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return org


async def ensure_admin_role(session, user: models.User, org_id: int) -> None:
    try:
        from app.services.rbac import Role as RoleEnum
    except Exception:
        return
    result = await session.execute(select(models.Role).where(models.Role.name == RoleEnum.ADMINISTRATOR.value))
    admin_role = result.scalar_one_or_none()
    if not admin_role:
        return
    existing = await session.execute(
        select(models.UserRole).where(
            models.UserRole.user_id == user.id,
            models.UserRole.role_id == admin_role.id,
            models.UserRole.organization_id == org_id,
        )
    )
    if existing.scalar_one_or_none():
        return
    session.add(
        models.UserRole(
            user_id=user.id,
            role_id=admin_role.id,
            organization_id=org_id,
        )
    )
    await session.commit()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update a PurveX admin user.")
    parser.add_argument("--email", required=False, help="Admin email (optional).")
    parser.add_argument("--username", required=False, help="Admin username (login).")
    parser.add_argument("--password", required=False, help="Admin password (optional; will prompt).")
    parser.add_argument(
        "--only-if-missing",
        action="store_true",
        help="Only prompt/create if no admin user exists.",
    )
    parser.add_argument(
        "--ensure-secure",
        action="store_true",
        help="If admin exists with default password, prompt to change it.",
    )
    args = parser.parse_args()

    async with async_sessionmaker() as session:
        existing_admin = await session.execute(
            select(models.User).where(models.User.is_admin == True)
        )
        admin = existing_admin.scalars().first()
        if args.only_if_missing and admin:
            print("Admin user already exists; skipping bootstrap.")
            return
        if args.ensure_secure and admin:
            if verify_password(settings.DEFAULT_ADMIN_PASSWORD, admin.hashed_password):
                print("Default admin password detected. Please set a new password.")
                username = admin.username or admin.email
                password = args.password or getpass.getpass("Admin password: ")
                if not password:
                    raise SystemExit("Password is required.")
                admin.hashed_password = hash_password(password)
                await session.commit()
                await ensure_admin_role(session, admin, admin.organization_id)
                print(f"Updated admin user: {username}")
            else:
                print("Admin password is already non-default; no action needed.")
            return
        username = (args.username or "").strip()
        email = (args.email or "").strip()
        if not username:
            username = input("Admin username: ").strip()
        if not email:
            email = username
        password = args.password or getpass.getpass("Admin password: ")
        if not username or not password:
            raise SystemExit("Username and password are required.")
        org = await ensure_org(session)
        user = admin
        if not user:
            result = await session.execute(
                select(models.User).where(
                    (models.User.email == email) | (models.User.username == username)
                )
            )
            user = result.scalar_one_or_none()

        if user:
            user.hashed_password = hash_password(password)
            user.is_admin = True
            user.is_active = True
            user.username = username
            await session.commit()
            await ensure_admin_role(session, user, user.organization_id)
            print(f"Updated admin user: {username}")
            return

        user = models.User(
            username=username,
            email=email,
            hashed_password=hash_password(password),
            is_admin=True,
            is_active=True,
            organization_id=org.id,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        await ensure_admin_role(session, user, org.id)
        print(f"Created admin user: {username}")


if __name__ == "__main__":
    asyncio.run(main())
