"""
Encrypt legacy plaintext secrets stored before field-level encryption.

This script intentionally refuses to run unless PURVEX_ENCRYPTION_KEY is set.
Running it with the dev ephemeral key would make existing credentials
undecryptable after restart.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import models
from app.db import async_sessionmaker, async_engine
from app.utils.encryption import (
    encrypt_value,
    has_configured_encryption_key,
    is_encrypted_value,
)
from sqlalchemy import select


async def backfill() -> int:
    if not has_configured_encryption_key():
        raise RuntimeError(
            "PURVEX_ENCRYPTION_KEY must be set before encrypting legacy secrets."
        )

    changed = 0
    async with async_sessionmaker() as session:
        siem_rows = await session.execute(select(models.SIEMConnection))
        for conn in siem_rows.scalars().all():
            if conn.credentials and not is_encrypted_value(conn.credentials):
                conn.credentials = encrypt_value(conn.credentials)
                changed += 1

        ai_rows = await session.execute(select(models.AIAssistantSettings))
        for ai_settings in ai_rows.scalars().all():
            if ai_settings.api_key and not is_encrypted_value(ai_settings.api_key):
                ai_settings.api_key = encrypt_value(ai_settings.api_key)
                changed += 1

        if changed:
            await session.commit()

    return changed


def main() -> int:
    try:
        changed = asyncio.run(backfill())
        print(f"Encrypted {changed} legacy secret field(s).")
        return 0
    finally:
        asyncio.run(async_engine.dispose())


if __name__ == "__main__":
    raise SystemExit(main())
