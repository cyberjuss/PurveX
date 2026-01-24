<div align="center">
  <img src="./frontend/public/logo.png" alt="PurveX" width="140" />
  <h1>PurveX</h1>
  <p><strong>Detection validation, done right.</strong></p>
  <p>Run controlled tests, verify what your SIEM sees, and close detection gaps — without becoming another SIEM.</p>

  <p>
    <img src="https://img.shields.io/badge/Status-Active-success" alt="Status" />
    <img src="https://img.shields.io/badge/Stack-FastAPI%20%2B%20Next.js-blue" alt="Stack" />
    <img src="https://img.shields.io/badge/License-Private-lightgrey" alt="License" />
  </p>
</div>

---

## ✨ What PurveX delivers
- ✅ **Validate detections** against real behavior
- 🧭 **Find coverage gaps** across MITRE ATT&CK
- 📡 **Verify telemetry health**
- 🧪 **Run tests safely** in lab/dev/prod
- 📊 **Clear results** with evidence and summaries

---

## 🚀 Quickstart (Linux)
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

## 🧭 First‑time onboarding
1) **Start PurveX** → `./scripts/start_purvex.sh`
2) **Connect your SIEM** → Settings → SIEM
3) **Register a runner** → Settings → Test Runner
4) **Run your first test** → Tests → Run Test

---

## 🔌 SIEM connection (safe by design)
PurveX does **not** mirror your SIEM. It validates detections.
- ✅ Pulls **only what’s needed** to confirm tests ran
- ✅ Uses **minimal access** and scoped queries
- ✅ Defaults to **deep links** back to your SIEM

### 🔒 What PurveX never collects
- ❌ Raw event logs
- ❌ Payloads
- ❌ PII or customer data
- ❌ Case notes or IR artifacts

---

## 🛑 Stop
Press `Ctrl+C` in the terminal running `./scripts/start_purvex.sh`.

---

<div align="center">
  <p>Built for detection engineers and purple teams.</p>
</div>
