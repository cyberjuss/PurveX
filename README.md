# PurveX (CLI-first Quickstart)

This setup runs PurveX locally with a CLI-first flow:
- Backend: Python + SQLite
- Frontend: Next.js
- UI port: `1120`
- Default login: `admin` / `admin`

## Requirements (Linux)

- Python 3.11+
- Node.js 18+
- npm

## Quickstart

```bash
git clone <your-private-repo-url>
cd PurveX

chmod +x scripts/verify_requirements.sh
./scripts/verify_requirements.sh

chmod +x scripts/start_purvex.sh
./scripts/start_purvex.sh
```

Open:
```
http://localhost:1120
```

Login:
```
admin / admin
```

## Notes

- SQLite database lives in `purvex.db`.
- Backend API runs on `http://127.0.0.1:8001`.
- The script installs dependencies on first run.

## Stop

Press `Ctrl+C` in the terminal running `start_purvex.sh`.
