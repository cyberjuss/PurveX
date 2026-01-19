# Contributing to PurveX

PurveX is a **security‑sensitive SaaS platform**. All contributions must treat security and tenant isolation as first‑class requirements, not afterthoughts.

## Security‑First Development Rules

These rules apply to **all code** (backend, frontend, scripts, infra):

- **Treat every input as untrusted**
  - Validate and sanitize all request data.
  - Use Pydantic models / FastAPI validators on the backend.
  - Use controlled React components and explicit validation on the frontend.

- **Enforce org_id / tenant isolation**
  - Every DB query must be scoped by `org_id` derived from the authenticated user (via `get_current_user`).
  - Never accept `org_id` from the client and never query across orgs.
  - Watch for IDOR: never fetch an object by `id` alone; always include `org_id` in the predicate.

- **Avoid injection and unsafe evaluation**
  - Do **not** build SQL strings; always use SQLAlchemy expressions and bound parameters.
  - Do **not** shell out using untrusted input. If you must call a process, use argument lists and explicit whitelisting.
  - Avoid `eval`, dynamic imports, or template string execution.

- **Never hardcode secrets**
  - Secrets, tokens, credentials, and keys must come from environment variables or a secret manager.
  - Do not commit `.env` files or any secret material to the repo.

- **Prefer explicit, simple designs**
  - Small, focused functions and services are easier to test and audit.
  - Avoid clever abstractions that hide auth, org scoping, or network calls.

- **Testing and review**
  - Add or update tests for critical paths, especially around auth, org isolation, and data access.
  - Call out security‑sensitive changes in PR descriptions.

## Frontend‑Specific Guidelines

- All HTTP calls go through the central `apiFetch` helper.
  - It is responsible for attaching auth, handling `401/403` by redirecting to login, and normalizing error handling.
- Assume auth tokens are in **httpOnly cookies** or short‑lived access tokens; **never** handle refresh tokens in JavaScript.
- Avoid `dangerouslySetInnerHTML`. If absolutely necessary, sanitize input first.
- User‑facing errors must be **generic**; do not show stack traces or raw backend error messages.
- Use `shadcn/ui` primitives and Tailwind classes; avoid inline styling that is hard to maintain.

## Backend‑Specific Guidelines

- Use FastAPI + Pydantic schemas for all endpoints.
- **Respect strict layering for backend code:**
  - **Routers**: HTTP concerns only (routing, auth/session checks, request/response models). Routers call services and must not talk to external systems (Splunk, Ollama, SSH, cloud storage) directly.
  - **Services**: business logic for PurveX concepts (detections, tests, scoring, AI analysis). Services must accept an explicit `org_id` and enforce tenant isolation on every data access.
  - **Adapters**: the only place that external APIs/clients live (Splunk SDK, HTTP clients, SSH libraries, cloud SDKs). Services call adapters; routers never do.
  - **Models**: plain SQLAlchemy entities only, no business logic.
- All services take an explicit `org_id` and scope queries accordingly.
- Handle network, DB, and external service calls with `try/except`.
  - Log unexpected exceptions with context, but return a generic `HTTPException` to the client.
- Do not expose internal IDs or secret fields in API responses.

## AI Assistants in This Repo

When using AI tooling (e.g., Cursor, Copilot, ChatGPT) to propose changes:

- Ask the assistant to explain security tradeoffs and point out potential vulnerabilities (OWASP Top 10, multitenancy, RBAC).
- Ensure suggested code:
  - Enforces `org_id` isolation.
  - Uses safe parameterization instead of string‑built SQL or shell.
  - Avoids exposing secrets or internal implementation details.

You are responsible for reviewing AI‑generated code with the same rigor as handwritten code.

## Refactors, Golden Modules, and Model Quality

- **Human review is required** for changes touching:
  - Authentication and authorization logic.
  - org_id / tenant‑isolation checks and any multi‑tenant data access.
  - External integrations (Splunk, Ollama, SSH/Atomic, cloud storage adapters).
  - Test execution pipelines and AI analysis flows.

- Run **periodic refactor sessions** on complex or high‑churn files. A useful prompt when using AI is:
  - “Refactor this file for clarity and maintainability without changing behavior. Call out any smells, duplication, or over‑complexity.”

- Treat the following as **golden examples** for backend style and structure:
  - `backend/app/routers/tests.py` (router responsibilities, auth, HTTP concerns).
  - `backend/app/services/scoring.py` (service‑layer business logic, org_id enforcement).

  When adding new backend code, match the layering, type hints, and error‑handling patterns used in those modules.

## Human Review & Refactors

- **Human review is mandatory** for changes that touch:
  - Authentication and authorization (JWT, RBAC, `get_current_user`).
  - org_id / multitenant isolation and any cross‑org data access.
  - External integrations (Splunk, Ollama, SSH, storage adapters).
  - Core scoring / lifecycle logic.
- Run periodic refactor sessions on key modules with a prompt like:
  - _“Refactor this file for clarity and maintainability without changing behavior. Call out any smells, duplication, or over‑complexity.”_
- When adding new backend code, prefer to **match the style and structure of** well‑factored modules such as:
  - `backend/app/routers/tests.py` (router patterns)
  - `backend/app/services/scoring.py` (service patterns)
  - and any other clearly documented “golden” modules noted in the codebase.


