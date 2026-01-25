#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="8001"
FRONTEND_PORT="1120"
MIN_NODE_VERSION="20.9.0"
MIN_NODE_MAJOR="20"
MIN_NODE_MINOR="9"
MIN_NODE_PATCH="0"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ROOT_DIR}/.env"
  set +a
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.11+ and retry."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "node/npm not found. Install Node.js ${MIN_NODE_VERSION}+ and retry."
  exit 1
fi

node_version_ok() {
  local version="$1"
  local major minor patch
  major="$(echo "${version}" | cut -d. -f1)"
  minor="$(echo "${version}" | cut -d. -f2)"
  patch="$(echo "${version}" | cut -d. -f3)"
  if [ "${major}" -lt "${MIN_NODE_MAJOR}" ]; then
    return 1
  fi
  if [ "${major}" -eq "${MIN_NODE_MAJOR}" ] && [ "${minor}" -lt "${MIN_NODE_MINOR}" ]; then
    return 1
  fi
  if [ "${major}" -eq "${MIN_NODE_MAJOR}" ] && [ "${minor}" -eq "${MIN_NODE_MINOR}" ] && [ "${patch}" -lt "${MIN_NODE_PATCH}" ]; then
    return 1
  fi
  return 0
}

maybe_use_nvm() {
  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${HOME}/.nvm/nvm.sh"
    if command -v nvm >/dev/null 2>&1; then
      nvm use "${MIN_NODE_VERSION}" >/dev/null 2>&1 || nvm use "${MIN_NODE_MAJOR}" >/dev/null 2>&1 || true
    fi
  fi
}

nodever="$(node -v | sed 's/^v//')"
if ! node_version_ok "${nodever}"; then
  maybe_use_nvm
  nodever="$(node -v | sed 's/^v//')"
fi
if ! node_version_ok "${nodever}"; then
  echo "Node.js ${MIN_NODE_VERSION}+ required. Found: ${nodever}"
  echo "Run scripts/setup_purvex.sh after installing the correct Node.js."
  exit 1
fi

export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
export OLLAMA_MODEL_NAME="${OLLAMA_MODEL_NAME:-gemma2:2b}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-${OLLAMA_MODEL_NAME}}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export PURVEX_ENV="${PURVEX_ENV:-dev}"
export OLLAMA_NUM_PREDICT="${OLLAMA_NUM_PREDICT:-128}"
export OLLAMA_NUM_CTX="${OLLAMA_NUM_CTX:-1536}"
export OLLAMA_TEMPERATURE="${OLLAMA_TEMPERATURE:-0.2}"
export OLLAMA_TOP_P="${OLLAMA_TOP_P:-0.9}"

ensure_jwt_secret() {
  local default_secret="super-secret-change-me-in-production"
  local legacy_default="super-secret-change-me"
  if [ -z "${JWT_SECRET_KEY:-}" ] || [ "${JWT_SECRET_KEY}" = "${default_secret}" ] || [ "${JWT_SECRET_KEY}" = "${legacy_default}" ]; then
    JWT_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
    export JWT_SECRET_KEY
    if [ ! -f "${ROOT_DIR}/.env" ]; then
      printf 'JWT_SECRET_KEY=%s\n' "${JWT_SECRET_KEY}" > "${ROOT_DIR}/.env"
    else
      if ! grep -q '^JWT_SECRET_KEY=' "${ROOT_DIR}/.env"; then
        printf '\nJWT_SECRET_KEY=%s\n' "${JWT_SECRET_KEY}" >> "${ROOT_DIR}/.env"
      fi
    fi
    echo "Generated JWT_SECRET_KEY and stored it in ${ROOT_DIR}/.env."
  fi
}

ensure_jwt_secret

start_backend() {
  echo "Starting backend on http://127.0.0.1:${BACKEND_PORT}"
  cd "${ROOT_DIR}/backend"
  if [ ! -f "venv/bin/activate" ]; then
    echo "Backend venv missing. Run scripts/setup_purvex.sh first."
    exit 1
  fi
  # shellcheck disable=SC1091
  source venv/bin/activate
  python -m uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --reload
}

start_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    echo "Ollama not found. Skipping local AI startup."
    return
  fi

  local ollama_url="http://127.0.0.1:11434"
  local model="${OLLAMA_MODEL_NAME:-mistral:7b}"
  if ! curl -fsS "${ollama_url}/api/tags" >/dev/null 2>&1; then
    echo "Starting Ollama on ${ollama_url}"
    (ollama serve >/dev/null 2>&1 &)
    for _ in {1..20}; do
      if curl -fsS "${ollama_url}/api/tags" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  else
    echo "Ollama already running at ${ollama_url}"
  fi

  if ! ollama list 2>/dev/null | grep -q "${model}"; then
    echo "Pulling Ollama model ${model} (first run only)..."
    ollama pull "${model}" || true
  fi
}

start_frontend() {
  echo "Starting frontend on http://127.0.0.1:${FRONTEND_PORT}"
  cd "${ROOT_DIR}/frontend"
  if [ ! -d "node_modules" ]; then
    echo "Frontend dependencies missing. Run scripts/setup_purvex.sh first."
    exit 1
  fi
  npm run dev -- --port "${FRONTEND_PORT}"
}

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}"
  fi
}

trap cleanup EXIT

start_ollama

start_backend &
BACKEND_PID=$!

start_frontend
