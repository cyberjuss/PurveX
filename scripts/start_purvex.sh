#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="8001"
FRONTEND_PORT="1120"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.11+ and retry."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "node/npm not found. Install Node.js 18+ and retry."
  exit 1
fi

export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:${BACKEND_PORT}"

start_backend() {
  echo "Starting backend on http://127.0.0.1:${BACKEND_PORT}"
  cd "${ROOT_DIR}/backend"
  if [ ! -d "venv" ]; then
    python3 -m venv venv
  fi
  # shellcheck disable=SC1091
  source venv/bin/activate
  pip install -r "${ROOT_DIR}/requirements.txt"
  python -m uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --reload
}

start_frontend() {
  echo "Starting frontend on http://127.0.0.1:${FRONTEND_PORT}"
  cd "${ROOT_DIR}/frontend"
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run dev -- --port "${FRONTEND_PORT}"
}

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}"
  fi
}

trap cleanup EXIT

start_backend &
BACKEND_PID=$!

start_frontend
