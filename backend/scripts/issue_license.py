"""Issue and manage PurveX paid-plan license keys.

Manual, by-hand issuance for now (v1) — run this yourself after a customer
pays, email them the printed token. See app/utils/license.py for how a
PurveX instance verifies it; nothing here talks to that instance, a
database, or the network. The signing keypair lives at
backend/.license_signing_key.pem (gitignored) and is created automatically
on first use.

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
"""

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

KEY_PATH = Path(__file__).resolve().parent.parent / ".license_signing_key.pem"


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
) -> None:
    if not KEY_PATH.exists():
        print("No signing key found — run 'python scripts/issue_license.py keygen' first.", file=sys.stderr)
        sys.exit(1)

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
    token = jwt.encode(claims, private_pem, algorithm="EdDSA")
    print(token)


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
        )


if __name__ == "__main__":
    main()
