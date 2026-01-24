# PurveX

**Detection validation, done right.**  
PurveX is a calm, fast, and safe purple‑team platform that lets you run controlled tests in a sandbox, verify SIEM telemetry, and close detection gaps with confidence.

---

## What you can do
- **Validate detections** against real telemetry (and see what actually fired)
- **Find coverage gaps** for MITRE ATT&CK techniques
- **Verify telemetry health** (Are logs even arriving?)
- **Run tests safely** using lab/dev/prod runners
- **Track results** with clean, explainable evidence

---

## Quickstart (Linux)

### Requirements
- **Python 3.11+**
- **Node.js 20.9+**
- **npm**

### One‑time setup
```bash
git clone <your-private-repo-url>
cd PurveX
chmod +x scripts/setup_purvex.sh
./scripts/setup_purvex.sh
```

### Start the platform
```bash
chmod +x scripts/start_purvex.sh
./scripts/start_purvex.sh
```

Open: `http://localhost:1120`  
Login: `admin / admin`

---

## First‑time onboarding (recommended order)

1) **Start PurveX**
- Run `./scripts/start_purvex.sh`

2) **Create a strong JWT secret** (production‑style)
- The start script will guide you if it’s missing.

3) **Connect a SIEM**
- Go to **Settings → SIEM**
- Add Splunk or Sentinel connection (credentials are stored securely, never returned)

4) **Register a runner (agent)**
- Go to **Settings → Test Runner**
- Download the registration script for your OS
- Run it on the target endpoint

5) **Run your first test**
- Go to **Tests → Run Test**
- Choose a test mode (Validate / Coverage / Telemetry)
- Select environment + runner, then execute

---

## Architecture (simple mental model)
- **Frontend**: Next.js UI on `http://localhost:1120`
- **Backend**: FastAPI on `http://127.0.0.1:8001`
- **DB**: SQLite (`purvex.db`) for local/dev

---

## SIEM connections (Splunk + Sentinel)
PurveX pulls the minimum required data securely:
- **Detections/alerts** (what fired, when, severity, rule link)
- **Events/telemetry** (raw or normalized event evidence)

Optional but supported:
- **Rules inventory** (enabled detections)
- **Evidence links** (deep links back to SIEM)
- **Health** (ingestion lag + auth status)

Credentials are stored server‑side only and **never returned** by the API.

---

## Agent / Runner behavior
- The agent **heartbeats** and **polls commands** (pause/resume) every few seconds
- Runner status updates from **online → pausing/paused → resuming/online**
- Test execution is **blocked** if a runner is paused

---

## Common issues (fast fixes)

**UI says “Resuming” too long**
- Re‑download the latest agent script and restart the agent

**Heartbeat 422 errors**
- Your agent is still hitting `/settings/.../heartbeat` (old script). Update to the latest script.

**Next.js version errors**
- Ensure **Node 20.9+**

---

## Security notes
- Credentials are **not echoed** back from APIs
- Permissions enforce **least privilege**
- Tokens are short‑lived where possible
- Rate‑limit and validation hooks are in place for abuse protection

---

## Stop
Press `Ctrl+C` in the terminal running `./scripts/start_purvex.sh`.
