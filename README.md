<div align="center">
  <img src="./frontend/public/purvex_logo.png" alt="PurveX" width="140" />
  <h1>PurveX</h1>
  <p><strong>Detection validation, done right.</strong></p>
  <p>Calm, fast, and safe purple‑team validation. Run controlled tests, verify SIEM telemetry, and close detection gaps with confidence.</p>

  <p>
    <img src="https://img.shields.io/badge/Status-Active-success" alt="Status" />
    <img src="https://img.shields.io/badge/Stack-FastAPI%20%2B%20Next.js-blue" alt="Stack" />
    <img src="https://img.shields.io/badge/License-Private-lightgrey" alt="License" />
  </p>
</div>

---

## ✨ What PurveX delivers
- **Validate detections** with real telemetry and outcomes
- **Find coverage gaps** across MITRE ATT&CK techniques
- **Verify telemetry health** (Are logs arriving?)
- **Run tests safely** in lab/dev/prod with agent runners
- **Track results clearly** with evidence and summaries

---

## 🚀 Quickstart (Linux)

### ✅ Requirements
- **Python 3.11+**
- **Node.js 20.9+**
- **npm**

### ⚙️ One‑time setup
```bash
git clone <your-private-repo-url>
cd PurveX
chmod +x scripts/setup_purvex.sh
./scripts/setup_purvex.sh
```

### ▶️ Start the platform
```bash
chmod +x scripts/start_purvex.sh
./scripts/start_purvex.sh
```

Open: `http://localhost:1120`  
Login: `admin / admin`

---

## 🧭 First‑time onboarding (best flow)

1) **▶️ Start PurveX**
- `./scripts/start_purvex.sh`

2) **🔐 Set a strong JWT secret**
- The start script will guide you if missing

3) **🔌 Connect a SIEM**
- Go to **Settings → SIEM**
- Add Splunk or Sentinel credentials

4) **🤖 Register a runner (agent)**
- Go to **Settings → Test Runner**
- Download the script for your OS
- Run it on the target endpoint

5) **🧪 Run your first test**
- Go to **Tests → Run Test**
- Choose a mode → pick environment → run

---

## 🧱 Architecture at a glance

| Layer | Tech | URL |
|------|------|-----|
| 🎨 Frontend | Next.js | `http://localhost:1120` |
| ⚙️ Backend | FastAPI | `http://127.0.0.1:8001` |
| 🗄️ Database | SQLite | `purvex.db` |

---

## 🔌 SIEM integration (Splunk + Sentinel)
Minimum required data (secure by design):
- 🔥 **Detections/alerts** (what fired, when, severity, rule mapping)
- 🧾 **Events/telemetry** (raw or normalized evidence)

Optional but supported:
- **Rules inventory** (enabled detections)
- **Evidence links** (deep links back to SIEM)
- **Health** (ingestion lag + auth status)

> 🛡️ Credentials are stored server‑side only and are **never returned** by the API.

---

## 🤖 Agent / runner behavior
- Agent heartbeats every few seconds
- Pause/Resume updates status in near‑real time
- Tests are **blocked** if the runner is paused

---

## ✅ Common quick fixes

**🔄 UI stuck on “Resuming”**  
Re‑download the latest agent script and restart the agent service.

**⚠️ Heartbeat 422 errors**  
Old agent script is still calling `/settings/.../heartbeat`. Update to the latest script.

**🧩 Next.js version errors**  
Ensure **Node 20.9+**.

---

## 🛑 Stop
Press `Ctrl+C` in the terminal running `./scripts/start_purvex.sh`.

---

<div align="center">
  <p>Built for detection engineers and purple teams.</p>
</div>
