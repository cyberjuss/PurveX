"""Reset a PurveX user's password directly, bypassing email.

The self-service /auth/password-reset flow delivers its reset link by
email. If SMTP isn't configured on a self-hosted install (see
app/routers/rbac.py's invite_user for the same gap on invites), a
locked-out user has no way to get that link. This lets someone with
server access reset the password directly, applying the same checks
the web flow does: password complexity, no reuse of the current or
recent passwords, and revoking any session issued before the reset.

Usage:
    python scripts/reset.py --username <username>
    python scripts/reset.py --email <email>
"""

import argparse
import asyncio
import getpass
from datetime import datetime, timezone

from sqlalchemy import select

from app import models
from app.config import settings
from app.db import async_sessionmaker
from app.security import hash_password, validate_password_complexity, verify_password


async def main() -> None:
    parser = argparse.ArgumentParser(description="Reset a PurveX user's password.")
    parser.add_argument("--username", help="Username of the account to reset.")
    parser.add_argument("--email", help="Email of the account to reset (alternative to --username).")
    parser.add_argument("--password", help="New password (optional; will prompt if omitted).")
    args = parser.parse_args()

    if not args.username and not args.email:
        raise SystemExit("Provide --username or --email.")

    async with async_sessionmaker() as session:
        if args.username:
            result = await session.execute(select(models.User).where(models.User.username == args.username))
        else:
            result = await session.execute(select(models.User).where(models.User.email == args.email))
        user = result.scalar_one_or_none()
        if not user:
            target = f"username '{args.username}'" if args.username else f"email '{args.email}'"
            raise SystemExit(f"No user found for {target}.")

        password = args.password or getpass.getpass("New password: ")
        if not password:
            raise SystemExit("Password is required.")

        is_valid, error = validate_password_complexity(password)
        if not is_valid:
            raise SystemExit(f"Password does not meet requirements: {error}")

        if user.hashed_password and verify_password(password, user.hashed_password):
            raise SystemExit("New password cannot be the same as the current password.")

        history_length = getattr(settings, "PASSWORD_HISTORY_LENGTH", 5)
        if history_length and history_length > 0:
            history_result = await session.execute(
                select(models.PasswordHistory)
                .where(models.PasswordHistory.user_id == user.id)
                .order_by(models.PasswordHistory.created_at.desc())
                .limit(history_length)
            )
            for entry in history_result.scalars().all():
                if verify_password(password, entry.hashed_password):
                    raise SystemExit("New password cannot match any of the user's recent passwords.")

        now = datetime.now(timezone.utc)
        new_hash = hash_password(password)
        user.hashed_password = new_hash
        # Revoke any session issued before this reset, same as the
        # self-service flow -- see auth.get_current_user's token_valid_after check.
        user.token_valid_after = now
        session.add(models.PasswordHistory(user_id=user.id, hashed_password=new_hash))
        await session.commit()
        print(f"Password reset for {user.username} ({user.email}). Existing sessions are now invalid.")


if __name__ == "__main__":
    asyncio.run(main())
