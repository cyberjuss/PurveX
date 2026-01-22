# PurveX (CLI-first Quickstart)

This setup runs PurveX locally with a CLI-first flow:
- Backend: Python + SQLite
- Frontend: Next.js
- UI port: `1120`
- Default login: `admin` / `admin`

## Requirements (Linux)

- Python 3.11+
- Node.js 20.9+
- npm

## Quickstart

```bash
git clone <your-private-repo-url>
cd PurveX

chmod +x scripts/setup_purvex.sh
./scripts/setup_purvex.sh

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
- Use `scripts/setup_purvex.sh` for one-time setup, then `scripts/start_purvex.sh` to run.

## Stop

Press `Ctrl+C` in the terminal running `start_purvex.sh`.
