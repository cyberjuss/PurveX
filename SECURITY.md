# PurveX Security Overview

This document summarizes the key security controls implemented in the PurveX platform and the recommended policy settings per environment.

## Roles and Permissions

PurveX uses role‑based access control (RBAC) backed by the `/rbac` API and a set of high‑level roles:

- **ADMINISTRATOR**
  - Full access to organization settings, SIEM connections, environment runner configs, testing policies, and user management.
  - Can assign/remove roles for other users and reset user passwords.
  - Should always have multi‑factor authentication (MFA) enabled and be limited to a small number of trusted operators.

- **ANALYST / OPERATOR** (implementation via role names such as `ANALYST`, `OPERATOR`, etc.)
  - Can view detections, tests, results, and dashboard data.
  - May be allowed to create or run tests depending on the organization’s policy (permissions such as `TESTS_RUN`, `DETECTIONS_CREATE`).
  - Cannot change RBAC assignments, SIEM connections, or global settings unless specifically delegated.

- **VIEWER / READ‑ONLY**
  - Can view dashboards and read data but cannot change configuration or trigger tests.

The exact mapping of permissions to role names is defined in the RBAC service (`backend/app/services/rbac.py`). The Settings → Users UI (`frontend/src/app/settings/users/page.tsx`) only exposes user and role management to users with the `SETTINGS_USERS_MANAGE` permission.

## Authentication Policy

Key controls are configured via `backend/app/config.py` and enforced in `backend/app/routers/auth.py`:

- **Password Hashing**
  - Bcrypt via `passlib` with an explicit cost factor: `bcrypt__rounds=12`.
  - Library pinned to `bcrypt==3.2.2` for compatibility and predictable performance.

- **Password Complexity and History**
  - Minimum 8 characters, requiring upper, lower, digit, and special character.
  - Password history tracked in `PasswordHistory` (see `backend/app/models.py`) and enforced on admin‑initiated and self‑service resets.
  - Config knob: `PASSWORD_HISTORY_LENGTH` (default `5`).

- **Lockout and Rate Limiting**
  - Per‑IP+username login rate limiting via `check_rate_limit`.
  - Account lockout using `failed_login_attempts` and `locked_until` columns on `User`.
  - Config knobs:
    - `LOGIN_MAX_ATTEMPTS` (default `5`)
    - `LOGIN_LOCKOUT_MINUTES` (default `30`)
    - `LOGIN_RATE_LIMIT_MAX_REQUESTS` (default `5`)
    - `LOGIN_RATE_LIMIT_WINDOW_SECONDS` (default `300`)

- **Recommended Policy by Environment**

| Setting                          | Dev / Local           | Staging                    | Production                  |
|----------------------------------|------------------------|----------------------------|-----------------------------|
| `LOGIN_MAX_ATTEMPTS`            | 10–20                  | 5–7                        | 5                           |
| `LOGIN_LOCKOUT_MINUTES`         | 5                      | 15–30                      | 30                          |
| `LOGIN_RATE_LIMIT_MAX_REQUESTS` | 10                     | 5–7                        | 5                           |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | 300                  | 300                        | 300                         |
| `PASSWORD_HISTORY_LENGTH`       | 1–3                    | 5                          | ≥5                          |

## Authorization and Org Scoping

High‑value APIs enforce RBAC and organization scoping:

- **RBAC API** (`backend/app/routers/rbac.py`)
  - All management endpoints require `SETTINGS_USERS_MANAGE` and use `require_org_id` to ensure users and roles are only managed within the caller’s organization.

- **Settings API** (`backend/app/routers/settings.py`)
  - Organization, SIEM connections, environment runner configs, and testing policies are protected by permissions such as `SETTINGS_ORG_MANAGE` and `SETTINGS_SIEM_MANAGE` and are scoped by `organization_id`.
  - `GET /settings/siem-connections` and all SIEM connection modifications are restricted to the current organization via `require_org_id`.

- **Detections and Tests** (`backend/app/routers/detections.py`, `tests.py`)
  - All queries and mutations are scoped to `organization_id` obtained from `require_org_id(current_user)`.
  - Additional permission checks (`require_detection_create`, `require_test_run`, etc.) restrict who can create/update detections or run tests.

The frontend respects these controls by using the `usePermissions` hook and hiding Settings → Users and similar management views unless the user has the appropriate permission.

## Input Validation and Sanitization

- Pydantic models (`backend/app/schemas.py`) define expected shapes and length limits for most request bodies.
- `utils/security.py` provides `sanitize_string`, `sanitize_email`, and `sanitize_url` used in security‑sensitive flows (password reset, invites, etc.).
- `utils/sanitize_inputs.py` is used to sanitize entire models before persisting to the database for settings, SIEM connections, detections, and tests.

## Transport, Storage, and Keys (Deployment Guidance)

These items are primarily handled at deployment time rather than directly in the app code:

- **TLS / HTTPS**
  - Run the API behind a TLS‑terminating reverse proxy or load balancer (Nginx, Envoy, cloud LB) and expose only HTTPS to users.
  - Enable HSTS at the edge and configure strong cipher suites.

- **Encryption at Rest**
  - Use encrypted volumes or a managed database with built‑in at‑rest encryption.
  - For particularly sensitive columns (SIEM credentials, future API tokens), consider app‑level encryption using a key stored in a secret manager.

- **Key Management**
  - Store `JWT_SECRET_KEY` and any future encryption keys in a dedicated secrets manager (e.g., Azure Key Vault, AWS Secrets Manager) rather than in `.env` files in production.
  - Establish a key rotation process and use short‑lived tokens for reset flows and similar operations.

- **Data Masking and Logging**
  - Avoid logging secrets, passwords, or tokens.
  - When exposing identifiers (e.g., API keys) in future UIs, show only partially masked values.

Keeping these controls configured and monitored—alongside regular dependency updates and vulnerability scanning—will keep PurveX aligned with modern SaaS security expectations.

