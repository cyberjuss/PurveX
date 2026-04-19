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
- **Role-based access** with granular permissions and 2FA support

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.11+ | `python --version` |
| Node.js | 20+ | `node --version` |
| npm | 9+ | `npm --version` |
| Git | any | `git --version` |

---

## Quickstart

### 1. Clone and configure

```bash
git clone https://github.com/cyberjuss/PurveX.git
cd PurveX
cp .env.example .env
```

Edit `.env` and set your keys (optional for dev — defaults work out of the box):

```bash
# Generate secrets (optional for local dev, required for production)
python -c "import secrets; print(secrets.token_urlsafe(32))"          # JWT_SECRET_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # PURVEX_ENCRYPTION_KEY
```

### 2. Start the platform

**Linux / macOS / Git Bash:**
```bash
chmod +x scripts/purvex.sh
./scripts/purvex.sh --setup     # Install dependencies (first time)
./scripts/purvex.sh --start     # Start backend + frontend
```

**Windows (manual):**
```powershell
# Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r ..\requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### 3. Open the app

- **Frontend:** [http://localhost:1120](http://localhost:1120)
- **Backend API:** [http://localhost:8001](http://localhost:8001)
- **API docs:** [http://localhost:8001/docs](http://localhost:8001/docs)

Default dev credentials: `admin` / `admin`

---

## First-time onboarding

1. **Log in** with the default admin account
2. **Connect your SIEM** — Settings &rarr; SIEM Connections
3. **Register a test runner** — Settings &rarr; Test Runner
4. **Run your first test** — Tests &rarr; Run Test
5. **Review results** — Dashboard &rarr; Detection scores and coverage

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
├── docs/                 # Project documentation
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

---

## Environment variables

See [`.env.example`](.env.example) for all options. Key settings:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET_KEY` | prod | JWT signing key |
| `PURVEX_ENCRYPTION_KEY` | prod | Fernet key for secrets at rest |
| `DATABASE_URL` | prod | PostgreSQL connection string |
| `PURVEX_ENV` | no | `dev` / `staging` / `prod` (default: `dev`) |
| `OPENAI_API_KEY` | no | Enables AI assistant features |

> In **dev mode**, missing keys are auto-generated. In **production**, the app blocks startup without required secrets and PostgreSQL.

---

## Documentation

Detailed docs are in the [`docs/`](docs/) directory:

- [Onboarding guide](docs/guides/ONBOARDING.md)
- [Detection workflow](docs/guides/DETECTIONS.md)
- [Testing guide](docs/guides/TESTING.md)
- [Security policy](docs/security/SECURITY.md)
- [MVP status & features](docs/mvp/OVERVIEW.md)

---

<div align="center">
  <p>Built for detection engineers and purple teams.</p>
</div>
