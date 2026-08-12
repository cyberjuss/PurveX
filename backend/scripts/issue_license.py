"""Issue and manage PurveX paid-plan license keys.

Run this yourself, or via poll_license_issuance.py's automated queue drain
(same signing logic, imported from here as issue_token/deliver_to_portal).
See app/utils/license.py for how a PurveX instance verifies a token;
nothing here talks to that instance, a database, or the network beyond the
optional --deliver-to push. The signing keypair lives at
backend/.license_signing_key.pem (gitignored) and is created automatically
on first use, and never leaves this machine either way.

Usage:
    python scripts/issue_license.py keygen
        Generate the signing keypair (once, ever). Prints the PUBLIC key —
        paste it into LICENSE_PUBLIC_KEY_PEM in every PurveX deployment's
        config (app/config.py or an env var), then never run this again.

    python scripts/issue_license.py issue --seats 0 --runners 0 --days 395
        Print a signed license token for a paid customer. --seats/--runners
        0 means unlimited; omit --days for a 395-day (~13 month) expiry,
        long enough to cover a missed renewal webhook without a hard cutoff.
        Schedules, Detection-as-Code, and Reports are unlocked and audit
        retention is unlimited by default -- pass --no-schedules,
        --no-detection-as-code, --no-reports, or --audit-retention-days to
        issue a more restricted key (e.g. for a future lower tier).

    python scripts/issue_license.py issue --seats 5 --days 35 --deliver-to <portal-user-id>
        Same as above, but also pushes the token straight into the portal's
        Supabase project so the customer can grab it themselves at
        /my-license -- no email round trip, no risk of it landing in spam.
        Issuance itself is unchanged: still entirely local, still signed
        with the key at backend/.license_signing_key.pem, which never
        leaves this machine. --deliver-to only changes how the already-
        issued token gets to the customer. The portal_account_id is in
        every payment/renewal notification email as "Portal account id".
        Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in your
        shell -- same service-role key already configured in the landing
        page's Vercel project for its own webhook (Supabase dashboard ->
        Project Settings -> API -> service_role key). This key can bypass
        Row Level Security on that project but cannot forge or verify a
        PurveX license -- it's a different secret with a different blast
        radius than the ed25519 signing key.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

KEY_PATH = Path(__file__).resolve().parent.parent / ".license_signing_key.pem"


class SigningKeyMissing(RuntimeError):
    """No signing key at KEY_PATH -- run `keygen` first."""


class DeliveryError(RuntimeError):
    """--deliver-to (or the poller) couldn't push the token to Supabase.

    The token itself was still issued successfully in every case this is
    raised for -- callers should treat this as "delivery failed, the token
    printed/returned above is still valid," not as issuance having failed.
    """


def require_supabase_credentials() -> tuple[str, str]:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise DeliveryError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use --deliver-to "
            "(see this script's --help for where to find them)."
        )
    return supabase_url, service_role_key


def deliver_to_portal(portal_user_id: str, token: str) -> None:
    """Push a just-issued token into the portal's Supabase project so the
    customer can retrieve it themselves at /my-license. stdlib-only (no new
    dependency) -- this is an occasional CLI/poller action, not something
    that needs the Supabase Python SDK. Raises DeliveryError on any
    failure; never exits the process, so both the CLI and the poller can
    decide for themselves how to handle it (the CLI exits, the poller
    marks one queue row as errored and moves on to the next).
    """
    supabase_url, service_role_key = require_supabase_credentials()

    body = json.dumps({
        "current_license_key": token,
        "license_issued_at": datetime.now(timezone.utc).isoformat(),
    }).encode("utf-8")

    request = urllib.request.Request(
        url=f"{supabase_url.rstrip('/')}/rest/v1/portal_profiles?user_id=eq.{portal_user_id}",
        data=body,
        method="PATCH",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            # return=representation, not the default minimal -- a PATCH
            # filtered by a user_id that doesn't exist returns 200 with an
            # empty result rather than an error. Without checking the body,
            # a typo'd portal_user_id would silently "succeed" and do
            # nothing, and the caller would have no idea delivery failed.
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            updated_rows = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise DeliveryError(
            f"Supabase returned {exc.code} {exc.reason}. Token was still issued -- fall back to emailing it."
        ) from exc
    except urllib.error.URLError as exc:
        raise DeliveryError(
            f"{exc.reason}. Token was still issued -- fall back to emailing it."
        ) from exc

    if not updated_rows:
        raise DeliveryError(
            f"No portal_profiles row matches user_id={portal_user_id}. Double-check the id. "
            "Token was still issued -- fall back to emailing it."
        )


def issue_token(
    *,
    seats: int,
    runners: int,
    days: int,
    plan: str = "paid",
    schedules: bool = True,
    detection_as_code: bool = True,
    reports: bool = True,
    audit_retention_days: int = 0,
    daily_test_runs: int = 0,
) -> str:
    """Sign and return a license token. Pure aside from reading the local
    signing key -- no printing, no delivery. Shared by the CLI's `issue`
    command below and poll_license_issuance.py, so both mint tokens
    exactly the same way. Raises SigningKeyMissing if `keygen` hasn't been
    run yet.
    """
    if not KEY_PATH.exists():
        raise SigningKeyMissing(
            f"No signing key found at {KEY_PATH} -- run 'python scripts/issue_license.py keygen' first."
        )
    private_pem = KEY_PATH.read_bytes()
    now = datetime.now(timezone.utc)
    claims = {
        "plan": plan,
        "seat_limit": None if seats == 0 else seats,
        "runner_limit": None if runners == 0 else runners,
        "schedules_enabled": schedules,
        "detection_as_code_enabled": detection_as_code,
        "reports_enabled": reports,
        "audit_retention_days": None if audit_retention_days == 0 else audit_retention_days,
        "daily_test_run_limit": None if daily_test_runs == 0 else daily_test_runs,
        "iat": now,
        "exp": now + timedelta(days=days),
    }
    return jwt.encode(claims, private_pem, algorithm="EdDSA")


def keygen() -> None:
    if KEY_PATH.exists():
        print(f"A signing key already exists at {KEY_PATH} — refusing to overwrite it.", file=sys.stderr)
        print("Issuing a new key would invalidate every license already sent out.", file=sys.stderr)
        sys.exit(1)

    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    KEY_PATH.write_bytes(private_pem)
    KEY_PATH.chmod(0o600)

    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")

    print(f"Signing key written to {KEY_PATH} — back this up somewhere safe, outside git.\n")
    print("Paste this into every PurveX deployment as LICENSE_PUBLIC_KEY_PEM:\n")
    print(public_pem)


def issue(
    seats: int,
    runners: int,
    days: int,
    plan: str,
    schedules: bool,
    detection_as_code: bool,
    reports: bool,
    audit_retention_days: int,
    daily_test_runs: int,
    deliver_to: str | None,
) -> None:
    try:
        token = issue_token(
            seats=seats,
            runners=runners,
            days=days,
            plan=plan,
            schedules=schedules,
            detection_as_code=detection_as_code,
            reports=reports,
            audit_retention_days=audit_retention_days,
            daily_test_runs=daily_test_runs,
        )
    except SigningKeyMissing as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    print(token)

    if deliver_to:
        try:
            deliver_to_portal(deliver_to, token)
        except DeliveryError as exc:
            print(f"Delivery failed: {exc}", file=sys.stderr)
            sys.exit(1)
        print(f"Delivered to portal account {deliver_to} -- they can retrieve it at /my-license now.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("keygen", help="Generate the signing keypair (once, ever).")

    issue_parser = subparsers.add_parser("issue", help="Print a signed license token.")
    issue_parser.add_argument("--plan", default="paid", choices=["paid"], help="Plan name embedded in the token.")
    issue_parser.add_argument("--seats", type=int, default=0, help="Max users; 0 = unlimited (default).")
    issue_parser.add_argument("--runners", type=int, default=0, help="Max test runners; 0 = unlimited (default).")
    issue_parser.add_argument("--days", type=int, default=395, help="Validity window in days (default 395).")
    issue_parser.add_argument("--no-schedules", dest="schedules", action="store_false", help="Disable scheduled/recurring test runs (enabled by default).")
    issue_parser.add_argument("--no-detection-as-code", dest="detection_as_code", action="store_false", help="Disable git detection sources/mirrors (enabled by default).")
    issue_parser.add_argument("--no-reports", dest="reports", action="store_false", help="Disable PDF report generation (enabled by default).")
    issue_parser.add_argument("--audit-retention-days", type=int, default=0, help="Audit log visibility window in days; 0 = unlimited (default).")
    issue_parser.add_argument("--daily-test-runs", type=int, default=0, help="Max test runs per day; 0 = unlimited (default).")
    issue_parser.add_argument("--deliver-to", metavar="PORTAL_USER_ID", default=None, help="Push the token to this portal account's Supabase row instead of (or alongside) copy-pasting it into an email -- see this script's --help for details.")

    args = parser.parse_args()
    if args.command == "keygen":
        keygen()
    elif args.command == "issue":
        issue(
            seats=args.seats,
            runners=args.runners,
            days=args.days,
            plan=args.plan,
            schedules=args.schedules,
            detection_as_code=args.detection_as_code,
            reports=args.reports,
            audit_retention_days=args.audit_retention_days,
            daily_test_runs=args.daily_test_runs,
            deliver_to=args.deliver_to,
        )


if __name__ == "__main__":
    main()
