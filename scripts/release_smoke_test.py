#!/usr/bin/env python3
"""
Release smoke-test runner for PurveX.

Automates core launch checks:
- Service reachability (backend/frontend)
- Auth flow (optional, with credentials)
- RBAC endpoint sanity
- Agent management endpoint sanity
- Canonical detections deep-link behavior

Usage:
  python scripts/release_smoke_test.py
  python scripts/release_smoke_test.py --username admin --password secret
  python scripts/release_smoke_test.py --backend-url http://127.0.0.1:8001 --frontend-url http://127.0.0.1:1120
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from typing import Optional

import requests


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def _ok(name: str, detail: str) -> CheckResult:
    return CheckResult(name=name, ok=True, detail=detail)


def _fail(name: str, detail: str) -> CheckResult:
    return CheckResult(name=name, ok=False, detail=detail)


def check_get(session: requests.Session, name: str, url: str, timeout: int = 10) -> CheckResult:
    try:
        res = session.get(url, timeout=timeout, allow_redirects=True)
        if 200 <= res.status_code < 400:
            return _ok(name, f"{url} -> {res.status_code}")
        return _fail(name, f"{url} -> {res.status_code}")
    except Exception as exc:  # pragma: no cover - defensive
        return _fail(name, f"{url} -> request failed: {exc}")


def login(
    session: requests.Session, backend_url: str, username: str, password: str
) -> tuple[Optional[CheckResult], bool]:
    login_url = f"{backend_url.rstrip('/')}/auth/login"
    try:
        res = session.post(
            login_url,
            data={"username": username, "password": password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
    except Exception as exc:  # pragma: no cover - defensive
        return _fail("Auth login", f"request failed: {exc}"), False

    if not res.ok:
        return _fail("Auth login", f"{login_url} -> {res.status_code}"), False

    payload = {}
    try:
        payload = res.json()
    except Exception:
        pass

    if payload.get("requires_2fa"):
        return _fail("Auth login", "2FA required; continue this run manually with browser flow"), False

    return _ok("Auth login", f"{login_url} -> {res.status_code}"), True


def fetch_csrf_token(session: requests.Session, backend_url: str) -> tuple[Optional[str], CheckResult]:
    csrf_url = f"{backend_url.rstrip('/')}/auth/csrf-token"
    try:
        res = session.get(csrf_url, timeout=10)
    except Exception as exc:  # pragma: no cover - defensive
        return None, _fail("CSRF token fetch", f"request failed: {exc}")

    if not res.ok:
        return None, _fail("CSRF token fetch", f"{csrf_url} -> {res.status_code}")

    try:
        data = res.json()
    except Exception:
        data = {}
    token = data.get("csrf_token")
    if not token:
        return None, _fail("CSRF token fetch", "csrf_token missing in response body")
    return token, _ok("CSRF token fetch", f"{csrf_url} -> {res.status_code}")


def run(args: argparse.Namespace) -> int:
    backend_url = args.backend_url.rstrip("/")
    frontend_url = args.frontend_url.rstrip("/")
    session = requests.Session()
    results: list[CheckResult] = []

    # Service reachability
    results.append(check_get(session, "Backend health", f"{backend_url}/health"))
    try:
        pre_auth_csrf = session.get(f"{backend_url}/auth/csrf-token", timeout=10)
        if pre_auth_csrf.status_code in {200, 401, 403}:
            results.append(_ok("Backend CSRF endpoint (pre-auth)", f"/auth/csrf-token -> {pre_auth_csrf.status_code}"))
        else:
            results.append(_fail("Backend CSRF endpoint (pre-auth)", f"/auth/csrf-token -> {pre_auth_csrf.status_code}"))
    except Exception as exc:
        results.append(_fail("Backend CSRF endpoint (pre-auth)", f"request failed: {exc}"))
    results.append(check_get(session, "Frontend login page", f"{frontend_url}/login"))

    # Canonical detections deep-link
    deep_link = f"{frontend_url}/detections?view=queue&search=untested"
    try:
        res = session.get(deep_link, timeout=12, allow_redirects=True)
        final_url = res.url
        if res.status_code == 200:
            results.append(_ok("Detections deep-link", f"{deep_link} -> 200 (final: {final_url})"))
        else:
            results.append(_fail("Detections deep-link", f"{deep_link} -> {res.status_code}"))
    except Exception as exc:  # pragma: no cover - defensive
        results.append(_fail("Detections deep-link", f"request failed: {exc}"))

    authed = False
    if args.username and args.password:
        login_result, authed = login(session, backend_url, args.username, args.password)
        if login_result:
            results.append(login_result)

    if authed:
        results.append(check_get(session, "Auth me", f"{backend_url}/auth/me"))
        results.append(check_get(session, "RBAC roles", f"{backend_url}/rbac/me/roles"))

        perms_result = check_get(session, "RBAC permissions", f"{backend_url}/rbac/me/permissions")
        results.append(perms_result)

        has_runner_manage = False
        try:
            perms_res = session.get(f"{backend_url}/rbac/me/permissions", timeout=10)
            if perms_res.ok:
                perms_payload = perms_res.json()
                if isinstance(perms_payload, list):
                    has_runner_manage = "settings:runners:manage" in perms_payload
        except Exception:
            pass

        results.append(check_get(session, "Environment runners list", f"{backend_url}/settings/environment-runners"))

        if has_runner_manage:
            csrf_token, csrf_result = fetch_csrf_token(session, backend_url)
            results.append(csrf_result)
            if not csrf_token:
                failures = [r for r in results if not r.ok]
                print("\nPurveX release smoke-test report")
                print("================================")
                for item in results:
                    status = "PASS" if item.ok else "FAIL"
                    print(f"[{status}] {item.name}: {item.detail}")
                print(f"\nResult: {len(failures)} failing automated checks.")
                return 1
            try:
                token_res = session.post(
                    f"{backend_url}/settings/agent-registration-token",
                    headers={"x-csrf-token": csrf_token},
                    timeout=10,
                )
                if token_res.ok:
                    results.append(_ok("Agent registration token issue", f"POST -> {token_res.status_code}"))
                else:
                    results.append(_fail("Agent registration token issue", f"POST -> {token_res.status_code}"))
            except Exception as exc:
                results.append(_fail("Agent registration token issue", f"request failed: {exc}"))
        else:
            results.append(_ok("Agent registration token issue", "skipped (user lacks settings:runners:manage)"))
    else:
        results.append(_ok("Authenticated checks", "skipped (provide --username and --password to enable)"))

    # Print report
    print("\nPurveX release smoke-test report")
    print("================================")
    failures = 0
    for item in results:
        status = "PASS" if item.ok else "FAIL"
        print(f"[{status}] {item.name}: {item.detail}")
        if not item.ok:
            failures += 1

    print("\nManual workflow checklist (run in browser)")
    print("------------------------------------------")
    print("1) Dashboard -> untested CTA -> detections queue loads with search prefilled")
    print("2) Tests -> schedule in lab/dev/prod respects permission gating and messages")
    print("3) Settings -> Agents: generate token explicitly (no auto-issue), download template script")
    print("4) Lab page: verify no duplicate agent registration flow appears")
    print("5) MITRE Explore: 'Has detections' filter returns non-placeholder results")

    if failures:
        print(f"\nResult: {failures} failing automated checks.")
        return 1

    print("\nResult: all automated checks passed.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run PurveX release smoke checks.")
    parser.add_argument("--backend-url", default="http://127.0.0.1:8001", help="Backend base URL")
    parser.add_argument("--frontend-url", default="http://127.0.0.1:1120", help="Frontend base URL")
    parser.add_argument("--username", help="Username for authenticated checks")
    parser.add_argument("--password", help="Password for authenticated checks")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(run(parse_args()))
