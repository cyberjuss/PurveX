#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="8001"
FRONTEND_PORT="1120"
MIN_NODE_VERSION="20.9.0"
MIN_NODE_MAJOR="20"
MIN_NODE_MINOR="9"
MIN_NODE_PATCH="0"
BACKEND_WORKERS="${BACKEND_WORKERS:-2}"

# Default to production settings unless explicitly overridden.
export PURVEX_ENV="${PURVEX_ENV:-prod}"
export USE_GUNICORN="${USE_GUNICORN:-1}"
export CREATE_DEFAULT_ADMIN="${CREATE_DEFAULT_ADMIN:-false}"
# Allow HTTP from loopback when running locally, even in prod-mode defaults.
export ALLOW_HTTP_LOCALHOST="${ALLOW_HTTP_LOCALHOST:-1}"
# Allow loopback to bypass rate limiting when running locally.
export ALLOW_RATE_LIMIT_LOCALHOST="${ALLOW_RATE_LIMIT_LOCALHOST:-1}"
# Pydantic expects JSON for list-typed env vars.
export CORS_ORIGINS="${CORS_ORIGINS:-[\"http://localhost:${FRONTEND_PORT}\",\"http://127.0.0.1:${FRONTEND_PORT}\"]}"

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
export PURVEX_ENV="${PURVEX_ENV:-prod}"
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
  export PYTHONPATH="${ROOT_DIR}/backend"
  if [ ! -f "venv/bin/activate" ]; then
    echo "Backend venv missing. Run scripts/setup_purvex.sh first."
    exit 1
  fi
  # shellcheck disable=SC1091
  source venv/bin/activate
  if [ "${PURVEX_ENV:-dev}" = "prod" ] || [ "${PROD:-0}" = "1" ]; then
    echo "Backend prod mode enabled (no reload)."
    if [ "${USE_GUNICORN:-0}" = "1" ]; then
      if command -v gunicorn >/dev/null 2>&1; then
        echo "Starting backend with gunicorn (${BACKEND_WORKERS} workers)."
        gunicorn -k uvicorn.workers.UvicornWorker -w "${BACKEND_WORKERS}" -b "127.0.0.1:${BACKEND_PORT}" app.main:app
      else
        echo "gunicorn not found in venv; falling back to uvicorn."
        python -m uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --workers "${BACKEND_WORKERS}"
      fi
    else
      python -m uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --workers "${BACKEND_WORKERS}"
    fi
  else
    python -m uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --reload
  fi
}

wait_for_db() {
  local db_path="${ROOT_DIR}/backend/purvex.db"
  local attempts=20
  local delay=0.5
  for _ in $(seq 1 "${attempts}"); do
    if [ -f "${db_path}" ]; then
      return 0
    fi
    sleep "${delay}"
  done
  return 1
}

bootstrap_admin_once() {
  if [ "${PURVEX_BOOTSTRAP_ADMIN:-1}" = "0" ]; then
    return
  fi
  local marker="${ROOT_DIR}/.purvex_admin_bootstrapped"
  if [ -f "${marker}" ]; then
    return
  fi
  echo "Admin setup: enter the username/password you want to use for login."
  cd "${ROOT_DIR}/backend"
  export PYTHONPATH="${ROOT_DIR}/backend"
  if [ ! -f "venv/bin/activate" ]; then
    echo "Backend venv missing. Run scripts/setup_purvex.sh first."
    exit 1
  fi
  # shellcheck disable=SC1091
  source venv/bin/activate
  if wait_for_db; then
    if python scripts/create_admin.py --only-if-missing; then
      echo "Admin setup complete. Use those credentials to sign in."
      touch "${marker}"
    else
      echo "Admin bootstrap failed; will retry on next start."
    fi
  else
    echo "Database not ready; skipping admin bootstrap. It will retry on next start."
  fi
}

prompt_admin_update() {
  if [ "${PURVEX_PROMPT_ADMIN_UPDATE:-1}" = "0" ]; then
    return
  fi
  if [ ! -t 0 ]; then
    return
  fi
  local answer
  echo ""
  read -r -p "Do you want to update the admin username/password now? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES)
      export PURVEX_ADMIN_UPDATE_REQUESTED=1
      ;;
    *)
      ;;
  esac
}

perform_admin_update() {
  if [ "${PURVEX_ADMIN_UPDATE_REQUESTED:-0}" != "1" ]; then
    return
  fi
  echo "Admin update: enter the username/password you want to use for login."
  cd "${ROOT_DIR}/backend"
  export PYTHONPATH="${ROOT_DIR}/backend"
  if [ ! -f "venv/bin/activate" ]; then
    echo "Backend venv missing. Run scripts/setup_purvex.sh first."
    exit 1
  fi
  # shellcheck disable=SC1091
  source venv/bin/activate
  if wait_for_db; then
    python scripts/create_admin.py
  else
    echo "Database not ready; skipping admin update."
  fi
}

check_backend_port() {
  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"${BACKEND_PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "Backend port ${BACKEND_PORT} is already in use. Stop the existing service or change BACKEND_PORT."
      return 1
    fi
  elif command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :${BACKEND_PORT} )" 2>/dev/null | tail -n +2 | grep -q LISTEN; then
      echo "Backend port ${BACKEND_PORT} is already in use. Stop the existing service or change BACKEND_PORT."
      return 1
    fi
  fi
  return 0
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
  if [ "${START_FRONTEND_SKIP_BUILD:-0}" = "1" ]; then
    echo "Skipping frontend build (START_FRONTEND_SKIP_BUILD=1)."
  else
    echo "Building frontend (production)..."
    npm run build
  fi
  echo "Launching frontend (production)..."
  PORT="${FRONTEND_PORT}" NODE_ENV=production npm run start
}

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}"
  fi
}

trap cleanup EXIT

start_ollama

prompt_boot_service() {
  local choice_file="${ROOT_DIR}/.purvex_boot_choice"
  if [ "${PURVEX_BOOT_PROMPTED:-0}" = "1" ]; then
    return
  fi
  export PURVEX_BOOT_PROMPTED=1
  # Only prompt/install when explicitly requested.
  if [ "${PURVEX_BOOT_PROMPT:-0}" != "1" ]; then
    return
  fi
  local answer
  echo ""
  read -r -p "Start PurveX on boot using systemd? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES)
      printf "yes\n" > "${choice_file}"
      if [ -x "${ROOT_DIR}/scripts/install_purvex_service.sh" ]; then
        if [ "${EUID}" -ne 0 ]; then
          echo "Systemd install requires sudo. Running with sudo..."
          sudo "${ROOT_DIR}/scripts/install_purvex_service.sh"
        else
          "${ROOT_DIR}/scripts/install_purvex_service.sh"
        fi
      else
        echo "Service installer not found at ${ROOT_DIR}/scripts/install_purvex_service.sh"
      fi
      ;;
    *)
      printf "no\n" > "${choice_file}"
      echo "Skipping systemd install."
      ;;
  esac
}

prompt_boot_service

prompt_admin_update

if ! check_backend_port; then
  exit 1
fi

start_backend &
BACKEND_PID=$!

bootstrap_admin_once

perform_admin_update

start_frontend
