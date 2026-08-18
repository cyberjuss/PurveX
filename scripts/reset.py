#!/usr/bin/env python3
"""Reset a PurveX user's password directly, bypassing email.

The self-service /auth/password-reset flow delivers its reset link by
email. If SMTP isn't configured on a self-hosted install (see
app/routers/rbac.py's invite_user for the same gap on invites), a
locked-out user has no way to get that link. This lets someone with
server access reset the password directly, applying the same checks
the web flow does: password complexity, no reuse of the current or
recent passwords, and revoking any session issued before the reset.

Also clears any failed-login lockout (see auth.login's
failed_login_attempts / locked_until). Nothing in the app can unlock an
account otherwise -- not even another admin -- so this is also the
answer to "the only admin locked themselves out, now what."

Run directly, from anywhere -- no venv activation needed:

    ./scripts/reset.py
    ./scripts/reset.py --username <username>
    ./scripts/reset.py --email <email>

(On Windows, or if it's not executable yet, run it as
`<python> scripts/reset.py` instead.)
"""

import argparse
import asyncio
import getpass
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# This file lives in scripts/, a sibling of backend/ (which is where the
# `app` package, its dependencies, and its venv all actually live).
_BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"

# Re-exec under the backend's own venv Python if a venv isn't already
# active -- so `./reset.py` works directly without activating it by hand
# first, the same way purvex.sh's launcher is self-contained.
#
# Deliberately NOT comparing resolved file paths (e.g.
# Path(sys.executable).resolve() != venv_python.resolve()) to decide this:
# venv/bin/python3 is very often a symlink straight to the system
# interpreter binary, so resolving through it collapses "invoked via the
# venv" and "invoked as bare system Python" to the exact same file,
# making that comparison wrongly conclude a venv is already active when
# its site-packages were never actually activated. sys.prefix vs
# sys.base_prefix is the mechanism Python itself uses to answer "is a
# venv currently active", so it's what we check too.
_in_venv = sys.prefix != sys.base_prefix

if not _in_venv:
    _venv_dir = _BACKEND_DIR / "venv"
    if os.name == "nt":
        _venv_candidates = [_venv_dir / "Scripts" / "python.exe"]
    else:
        # Some venvs only create a versioned "python3" symlink, not a
        # bare "python" one, so check both rather than assume.
        _venv_candidates = [_venv_dir / "bin" / "python", _venv_dir / "bin" / "python3"]
    _venv_python = next((p for p in _venv_candidates if p.exists()), None)

    if _venv_python is None:
        print(
            f"[reset.py] Warning: no venv Python found under {_venv_dir} -- "
            f"continuing with {sys.executable}, which may be missing dependencies "
            f"(run '{_BACKEND_DIR.parent}/scripts/purvex.sh --setup' first if this fails).",
            file=sys.stderr,
        )
    else:
        import subprocess

        # subprocess.run rather than os.execv -- more portable (execv has
        # inconsistent stdio/process-replacement behavior on Windows) and
        # inherits this process's stdin/stdout/stderr by default, so
        # interactive prompts still work normally through the re-exec.
        result = subprocess.run([str(_venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])
        sys.exit(result.returncode)

# Add backend/ to sys.path so the import below resolves no matter what
# directory this is run from.
sys.path.insert(0, str(_BACKEND_DIR))

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

    username = args.username
    email = args.email
    if not username and not email:
        username = input("Username or email: ").strip()
        if not username:
            raise SystemExit("Username or email is required.")
        if "@" in username:
            email = username
            username = None

    async with async_sessionmaker() as session:
        if username:
            result = await session.execute(select(models.User).where(models.User.username == username))
        else:
            result = await session.execute(select(models.User).where(models.User.email == email))
        user = result.scalar_one_or_none()
        if not user:
            target = f"username '{username}'" if username else f"email '{email}'"
            raise SystemExit(f"No user found for {target}.")

        if args.password:
            password = args.password
        else:
            password = getpass.getpass("New password (8+ characters, upper/lower/digit/symbol): ")
            if password != getpass.getpass("Confirm password: "):
                raise SystemExit("Passwords did not match.")
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

        was_locked = bool(getattr(user, "locked_until", None))

        now = datetime.now(timezone.utc)
        new_hash = hash_password(password)
        user.hashed_password = new_hash
        # Revoke any session issued before this reset, same as the
        # self-service flow -- see auth.get_current_user's token_valid_after check.
        user.token_valid_after = now
        # Clear any failed-login lockout -- otherwise the new password still
        # won't work until the lockout timer expires on its own.
        user.failed_login_attempts = 0
        user.locked_until = None
        session.add(models.PasswordHistory(user_id=user.id, hashed_password=new_hash))
        await session.commit()
        print(f"Password reset for {user.username} ({user.email}). Existing sessions are now invalid.")
        if was_locked:
            print("Account was locked out from failed login attempts -- that lock has been cleared too.")


if __name__ == "__main__":
    asyncio.run(main())
