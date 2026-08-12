<div align="center">
  <img src="./frontend/public/logo.png" alt="PurveX" width="140" />
  <h1>PurveX</h1>
  <p><strong>Detection Engineering & Validation Platform</strong></p>
  <p>Run controlled attack simulations, verify your SIEM detections fire, score coverage, and close gaps across MITRE ATT&CK.</p>

  <p>
    <img src="https://img.shields.io/badge/Status-Active-success" alt="Status" />
    <img src="https://img.shields.io/badge/Backend-FastAPI-009688" alt="Backend" />
    <img src="https://img.shields.io/badge/Frontend-Next.js%2016-black" alt="Frontend" />
    <img src="https://img.shields.io/badge/License-Private-lightgrey" alt="License" />
  </p>

  <p>
    <a href="https://purve-x-landing-page.vercel.app/install-guide">Full install guide</a> ·
    <a href="https://purve-x-landing-page.vercel.app">Website</a>
  </p>
</div>

---

## What is PurveX?

PurveX is a detection validation platform for security teams. It connects to your SIEM, runs Atomic Red Team tests against your environment, and tells you whether your detections actually fired — with evidence.

**Core workflow:** Create detection rule &rarr; Run attack simulation &rarr; Query SIEM &rarr; Score result &rarr; Track coverage

### Key capabilities
- **Test detections** against real adversary behavior using Atomic Red Team
- **Score & track** detection health over time with automated scoring
- **Map coverage** across MITRE ATT&CK techniques and tactics
- **Connect any SIEM** — Splunk, Elastic, Sentinel, and more
- **Generate reports** with evidence, scores, and recommendations
- **AI-assisted analysis** for test failures and tuning suggestions
- **Role-based access** with granular permissions

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.11+ | `python --version` |
| Node.js | 20+ | `node --version` |
| npm | 9+ | `npm --version` |
| Git | optional | `git --version` |

No database installation is required. PurveX stores its data in a local SQLite file by default; PostgreSQL is only worth setting up once more than a couple of people share the same instance (set `DATABASE_URL` to switch).

---

## Quickstart

The one-line installer clones the repo, installs dependencies, and starts PurveX:

```bash
curl -fsSL https://purve-x-landing-page.vercel.app/install.sh | bash
```

If Python or Node.js is missing, it detects your OS, prints the exact command to install it, and offers to run that for you once you confirm. Once you see `Web:` and `API:` printed, open [http://localhost:1120](http://localhost:1120).

Prefer to run it by hand?

```bash
git clone https://github.com/cyberjuss/PurveX.git && \
  cd PurveX && \
  chmod +x scripts/purvex.sh && \
  ./scripts/purvex.sh --setup && \
  ./scripts/purvex.sh --start
```

`--setup` generates `.env` and its two secrets (`JWT_SECRET_KEY`, `PURVEX_ENCRYPTION_KEY`) automatically the first time it runs — nothing to create or paste in by hand. **Back up `PURVEX_ENCRYPTION_KEY`** somewhere safe once it exists; losing it makes any stored SIEM credentials unrecoverable.

Windows without Git Bash or WSL: see the [Windows setup guide](https://purve-x-landing-page.vercel.app/install-guide/windows) for the manual two-terminal version.

### First run

A fresh install has no account yet, so opening the app takes you straight to setup instead of a login form. Choose a username and password there — there is no default account. See the [First run guide](https://purve-x-landing-page.vercel.app/install-guide/first-run) for the full walkthrough.

---

## First-time onboarding

The dashboard tracks five setup steps; none of them block you from exploring the app first, but all five are required before you can run a real test.

1. **Connect a SIEM** — Settings &rarr; SIEM
2. **Install the Atomic Red Team test catalog** — Tests &rarr; Explore Coverage
3. **Register a test runner** — Endpoints &rarr; Add runner
4. **Import or write a detection** — Detections
5. **Run your first test** — Tests &rarr; Run Test

---

## Architecture

```
PurveX/
├── backend/              # FastAPI + SQLAlchemy
│   ├── app/
│   │   ├── routers/      # API endpoints (auth, tests, detections, settings, ...)
│   │   ├── services/     # Business logic (scoring, SIEM adapters, AI assistant)
│   │   ├── middleware/    # CSRF, security headers
│   │   ├── utils/        # Encryption, auth helpers, input sanitization
│   │   └── models.py     # SQLAlchemy models
│   └── data/             # MITRE ATT&CK catalog
├── frontend/             # Next.js 16 + React 19 + Tailwind CSS
│   └── src/
│       ├── app/          # Pages (dashboard, detections, tests, mitre, reports, ...)
│       ├── components/   # Shared UI components
│       └── lib/          # API client, utilities
├── scripts/              # Setup and launcher scripts
└── requirements.txt      # Python dependencies
```

---

## SIEM integration

PurveX validates detections — it does **not** mirror or store your SIEM data.

- Pulls only the minimum needed to confirm whether a test triggered an alert
- Uses scoped queries with minimal permissions
- Defaults to deep-linking back to your SIEM for full event details

### What PurveX never collects
- Raw event logs or payloads
- PII or customer data
- Case notes or IR artifacts

See [what PurveX does and doesn't collect](https://purve-x-landing-page.vercel.app/install-guide/data-handling) for the full breakdown.

---

## Environment variables

See [`.env.example`](.env.example) for all options. `./scripts/purvex.sh --setup` fills in the two required secrets automatically; everything else has a sensible default.

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET_KEY` | auto-generated | JWT signing key |
| `PURVEX_ENCRYPTION_KEY` | auto-generated | Fernet key for secrets at rest — back this up |
| `DATABASE_URL` | no | PostgreSQL connection string; unset means local SQLite |
| `PURVEX_ENV` | no | `dev` / `staging` / `prod` (default: `dev`) |
| `OPENAI_API_KEY` | no | Enables AI assistant features |

---

## Troubleshooting & FAQ

See the [troubleshooting guide](https://purve-x-landing-page.vercel.app/install-guide/troubleshooting) and [FAQ](https://purve-x-landing-page.vercel.app/install-guide/faq) for the problems that come up most often during and after install.

---

<div align="center">
  <p>Built for detection engineers and purple teams.</p>
</div>
