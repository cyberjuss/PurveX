"""Drain license_issuance_queue and deliver signed license tokens.

Run this on the same machine that holds backend/.license_signing_key.pem
-- that key never leaves this machine either way, this script just removes
the human from the common-case path. The Stripe webhook (a server, which
must never hold the signing key) drops a row here for every new paid
signup and every subscription renewal; this script, invoked on a schedule
(cron / Windows Task Scheduler -- see the ship-to-production runbook in
PurveX-internal, or just run it manually), signs each pending row locally with
issue_license.py's issue_token() and pushes it straight to the customer's
portal account with deliver_to_portal(). One pass drains everything
currently pending, then exits -- run it again on whatever cadence you want
delivery latency to be (every 5 minutes is plenty).

A row that fails (delivery error, bad data) is marked processed with the
error recorded, not retried forever -- the owner notification email sent
by the webhook is still the fallback for exactly this case: it has the
same command this script runs internally, ready to paste in by hand.

Usage:
    python scripts/poll_license_issuance.py

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment,
same as issue_license.py --deliver-to.
"""

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from issue_license import (  # noqa: E402
    DeliveryError,
    SigningKeyMissing,
    deliver_to_portal,
    issue_token,
    require_supabase_credentials,
)

BATCH_LIMIT = 25


def _supabase_request(method: str, path: str, *, body: dict | None = None) -> object:
    supabase_url, service_role_key = require_supabase_credentials()
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url=f"{supabase_url.rstrip('/')}/rest/v1/{path}",
        data=data,
        method=method,
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_pending() -> list[dict]:
    return _supabase_request(
        "GET",
        f"license_issuance_queue?processed_at=is.null&order=created_at.asc&limit={BATCH_LIMIT}",
    )


def mark_processed(row_id: int, *, error: str | None = None) -> None:
    _supabase_request(
        "PATCH",
        f"license_issuance_queue?id=eq.{row_id}",
        body={
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "error": error,
        },
    )


def process_row(row: dict) -> None:
    portal_user_id = row["portal_user_id"]
    try:
        token = issue_token(seats=row["seats"], runners=row["runners"], days=row["days"])
        deliver_to_portal(portal_user_id, token)
    except SigningKeyMissing:
        # Fatal for the whole run, not this row -- let it propagate to
        # main(), which stops without marking this (or any later) row
        # processed. Must be checked before the generic Exception handler
        # below, since SigningKeyMissing is itself a RuntimeError.
        raise
    except DeliveryError as exc:
        print(f"[row {row['id']}] delivery failed for {portal_user_id}: {exc}", file=sys.stderr)
        mark_processed(row["id"], error=str(exc))
        return
    except Exception as exc:  # noqa: BLE001 -- one bad row must never kill the batch
        print(f"[row {row['id']}] unexpected error for {portal_user_id}: {exc}", file=sys.stderr)
        mark_processed(row["id"], error=str(exc))
        return

    mark_processed(row["id"])
    print(f"[row {row['id']}] issued and delivered to {portal_user_id} ({row['kind']}).")


def main() -> None:
    try:
        pending = fetch_pending()
    except (urllib.error.HTTPError, urllib.error.URLError, DeliveryError) as exc:
        print(f"Failed to fetch pending queue rows: {exc}", file=sys.stderr)
        sys.exit(1)

    if not pending:
        print("No pending license issuances.")
        return

    print(f"{len(pending)} pending issuance(s).")
    for row in pending:
        try:
            process_row(row)
        except SigningKeyMissing as exc:
            # Fatal for the whole run, not just this row -- nothing can be
            # signed without the key, and every remaining row (including
            # this one, left untouched) will still be here next run once
            # it exists.
            print(str(exc), file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
