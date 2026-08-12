#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# purvex.sh — Unified PurveX launcher for Linux / macOS / Git Bash (Windows)
#
# Usage:
#   ./scripts/purvex.sh --start          Start backend + frontend (production build)
#   ./scripts/purvex.sh --dev            Start backend + frontend (dev mode, hot reload)
#   ./scripts/purvex.sh --setup          Install all dependencies
#   ./scripts/purvex.sh --rebuild        Rebuild and restart everything
#   ./scripts/purvex.sh --help           Show this help
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
LOG_DIR="${ROOT_DIR}/.purvex/logs"
BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-1120}"
MIN_PYTHON="3.11"
MIN_NODE="20"

# Colors (safe for dumb terminals)
if [ -t 1 ]; then
  BOLD="\033[1m"; DIM="\033[2m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; CYAN="\033[36m"; RESET="\033[0m"
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi

# Enterprise-style CLI: one prefix, minimal repetition
info()  { printf "${BOLD}${GREEN}[purvex]${RESET} %s\n" "$*"; }
warn()  { printf "${BOLD}${YELLOW}[purvex]${RESET} %s\n" "$*"; }
fail()  { printf "${BOLD}${RED}[purvex]${RESET} %s\n" "$*"; exit 1; }
dim()   { printf "${DIM}%s${RESET}\n" "$*"; }

banner_line() {
  printf "${DIM}%s${RESET}\n" "──────────────────────────────────────────────────────────────"
}

# Two-column aligned row (label width 10)
kv() {
  local label="$1"
  local value="$2"
  printf "  ${BOLD}%-10s${RESET} %s\n" "${label}" "${value}"
}

print_urls() {
  local api="${1}"
  local web="${2}"
  printf "\n"
  info "Web: ${web}"
  info "API: ${api}"
  printf "\n"
}

# ── Dependency checks ────────────────────────────────────────────────────────

find_python() {
  for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
      local ver
      ver="$("$cmd" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")"
      local major minor
      major="${ver%%.*}"
      minor="${ver##*.}"
      if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then
        echo "$cmd"
        return
      fi
    fi
  done
  echo ""
}

# Distro detected via /etc/os-release (Linux) or `uname -s` (macOS).
os_id() {
  if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "${ID:-}"
    return
  fi
  echo ""
}

# Reads a y/N answer from the real terminal, not this script's own stdin --
# when invoked as `curl ... | bash`, stdin is the piped script text itself,
# so a plain `read` would silently get nothing back. /dev/tty is the
# controlling terminal regardless of how stdin got redirected, which is the
# standard fix for prompting inside a piped installer. No /dev/tty (fully
# non-interactive: CI, a script with no terminal attached at all) means
# there is nobody to ask, so this returns "no" rather than hanging.
confirm() {
  local prompt="$1"
  [ -e /dev/tty ] || return 1
  local reply=""
  read -r -p "${prompt} [y/N] " reply < /dev/tty || return 1
  case "${reply}" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# Sets PYTHON_INSTALL_CMD to the install command for this OS (empty if none
# known) and prints it either way. Never runs it here -- installing a
# package, usually via sudo, only happens after the operator explicitly
# confirms in check_python.
describe_install_python() {
  PYTHON_INSTALL_CMD=""
  printf "\n"
  case "$(os_id)" in
    ubuntu|debian|kali|linuxmint|raspbian|pop)
      PYTHON_INSTALL_CMD="sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip"
      ;;
    fedora|rhel|centos|rocky|almalinux)
      PYTHON_INSTALL_CMD="sudo dnf install -y python3 python3-pip"
      ;;
    arch|manjaro|endeavouros)
      PYTHON_INSTALL_CMD="sudo pacman -S --noconfirm python python-pip"
      ;;
    *)
      if [ "$(uname -s)" = "Darwin" ]; then
        PYTHON_INSTALL_CMD="brew install python@3.12"
      fi
      ;;
  esac
  if [ -n "${PYTHON_INSTALL_CMD}" ]; then
    warn "Install Python ${MIN_PYTHON}+:"
    dim "  ${PYTHON_INSTALL_CMD}"
  else
    warn "Download an installer for Python ${MIN_PYTHON}+: https://www.python.org/downloads/"
  fi
  printf "\n"
}

# Same as describe_install_python, for Node.js -> NODE_INSTALL_CMD.
describe_install_node() {
  NODE_INSTALL_CMD=""
  printf "\n"
  case "$(os_id)" in
    ubuntu|debian|kali|linuxmint|raspbian|pop)
      NODE_INSTALL_CMD="curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE}.x | sudo -E bash - && sudo apt-get install -y nodejs"
      ;;
    fedora|rhel|centos|rocky|almalinux)
      NODE_INSTALL_CMD="curl -fsSL https://rpm.nodesource.com/setup_${MIN_NODE}.x | sudo -E bash - && sudo dnf install -y nodejs"
      ;;
    arch|manjaro|endeavouros)
      NODE_INSTALL_CMD="sudo pacman -S --noconfirm nodejs npm"
      ;;
    *)
      if [ "$(uname -s)" = "Darwin" ]; then
        NODE_INSTALL_CMD="brew install node@${MIN_NODE}"
      fi
      ;;
  esac
  if [ -n "${NODE_INSTALL_CMD}" ]; then
    warn "Install Node.js ${MIN_NODE}+:"
    dim "  ${NODE_INSTALL_CMD}"
  else
    warn "Download an installer for Node.js ${MIN_NODE}+: https://nodejs.org/en/download"
  fi
  printf "\n"
}

check_python() {
  PYTHON="$(find_python)"
  if [ -z "$PYTHON" ]; then
    describe_install_python
    if [ -n "${PYTHON_INSTALL_CMD}" ] && confirm "Install Python now?"; then
      info "Running: ${PYTHON_INSTALL_CMD}"
      bash -c "${PYTHON_INSTALL_CMD}" < /dev/tty || true
      PYTHON="$(find_python)"
    fi
    if [ -z "$PYTHON" ]; then
      fail "Python ${MIN_PYTHON}+ is required but not found."
    fi
  fi
  if [ "${PURVEX_QUIET_RUNTIME:-}" != "1" ]; then
    info "Python: $($PYTHON --version)"
  fi
}

check_node() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    describe_install_node
    if [ -n "${NODE_INSTALL_CMD}" ] && confirm "Install Node.js now?"; then
      info "Running: ${NODE_INSTALL_CMD}"
      bash -c "${NODE_INSTALL_CMD}" < /dev/tty || true
    fi
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
      fail "Node.js ${MIN_NODE}+ and npm are required."
    fi
  fi
  local node_major
  node_major="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "${node_major}" -lt "${MIN_NODE}" ]; then
    fail "Node.js ${MIN_NODE}+ required. Found: $(node -v)"
  fi
  if [ "${PURVEX_QUIET_RUNTIME:-}" != "1" ]; then
    info "Node: $(node -v)  npm: $(npm -v)"
  fi
}

runtime_summary() {
  local py_ver
  py_ver="$($PYTHON --version 2>&1 | sed 's/^Python //')"
  kv "Runtime" "Python ${py_ver}  ·  Node $(node -v)  ·  npm $(npm -v)"
}

# ── .env loader ──────────────────────────────────────────────────────────────

load_env() {
  if [ -f "${ROOT_DIR}/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    . "${ROOT_DIR}/.env"
    set +a
    if [ "${PURVEX_QUIET_RUNTIME:-}" != "1" ]; then
      info "Loaded .env"
    fi
  fi
  export CORS_ORIGINS="${CORS_ORIGINS:-[\"http://localhost:${FRONTEND_PORT}\",\"http://127.0.0.1:${FRONTEND_PORT}\"]}"
  export ALLOW_HTTP_LOCALHOST="${ALLOW_HTTP_LOCALHOST:-1}"
  export ALLOW_RATE_LIMIT_LOCALHOST="${ALLOW_RATE_LIMIT_LOCALHOST:-1}"
}

# ── .env bootstrap ───────────────────────────────────────────────────────────
# Generates the two secrets PurveX needs at boot (JWT_SECRET_KEY,
# PURVEX_ENCRYPTION_KEY) instead of asking the operator to run Python
# one-liners and paste the output in by hand. Both are pure stdlib (no
# `cryptography` package needed yet -- a Fernet key is just urlsafe-base64
# of 32 random bytes, so this can run before setup_backend installs
# anything). Only fills in what's missing; never touches a value that's
# already set, so re-running --setup is safe.

env_var_is_set() {
  local key="$1"
  grep -qE "^${key}=.+" "${ROOT_DIR}/.env" 2>/dev/null
}

set_env_var() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "${ROOT_DIR}/.env" 2>/dev/null; then
    # -i.bak suffix form works on both GNU sed (Linux/Git Bash) and BSD sed
    # (macOS) without needing an OS check.
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "${ROOT_DIR}/.env" && rm -f "${ROOT_DIR}/.env.bak"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${ROOT_DIR}/.env"
  fi
}

ensure_env_file() {
  if [ ! -f "${ROOT_DIR}/.env" ]; then
    if [ -f "${ROOT_DIR}/.env.example" ]; then
      cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
    else
      touch "${ROOT_DIR}/.env"
    fi
    info "Created .env"
  fi

  if ! env_var_is_set "JWT_SECRET_KEY"; then
    local jwt_key
    jwt_key="$($PYTHON -c 'import secrets; print(secrets.token_urlsafe(32))')"
    set_env_var "JWT_SECRET_KEY" "${jwt_key}"
    info "Generated JWT_SECRET_KEY"
  fi

  if ! env_var_is_set "PURVEX_ENCRYPTION_KEY"; then
    local enc_key
    enc_key="$($PYTHON -c 'import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())')"
    set_env_var "PURVEX_ENCRYPTION_KEY" "${enc_key}"
    info "Generated PURVEX_ENCRYPTION_KEY"
    warn "Back up PURVEX_ENCRYPTION_KEY (in .env) somewhere safe -- losing it makes any stored SIEM credentials unrecoverable."
  fi
}

# ── Setup ────────────────────────────────────────────────────────────────────

setup_backend() {
  info "Setting up backend..."
  cd "${BACKEND_DIR}"

  if [ ! -d "venv" ]; then
    info "Creating Python virtual environment..."
    $PYTHON -m venv venv
  fi

  # Activate (cross-platform: Git Bash uses Scripts/, Linux uses bin/)
  if [ -f "venv/Scripts/activate" ]; then
    # shellcheck disable=SC1091
    source venv/Scripts/activate
  elif [ -f "venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    source venv/bin/activate
  else
    fail "Could not find venv activate script."
  fi

  info "Installing Python dependencies..."
  # python -m pip: reliable on Windows/Git Bash (venv Scripts/pip often not +x)
  python -m pip install --upgrade pip -q
  python -m pip install -r "${ROOT_DIR}/requirements.txt" -q
  if [ -f "${BACKEND_DIR}/requirements-dev.txt" ]; then
    python -m pip install -r "${BACKEND_DIR}/requirements-dev.txt" -q
  fi
  info "Backend dependencies installed."
}

setup_frontend() {
  info "Setting up frontend..."
  cd "${FRONTEND_DIR}"
  npm install
  info "Frontend dependencies installed."
}

run_setup() {
  check_python
  check_node
  ensure_env_file
  load_env
  setup_backend
  setup_frontend
  info "Setup complete. Run: ./scripts/purvex.sh --start"
}

# ── Start ────────────────────────────────────────────────────────────────────

BACKEND_PID=""
FRONTEND_PID=""
CLEANUP_DONE=0
BACKEND_LOG_FILE=""
FRONTEND_LOG_FILE=""

ensure_log_dir() {
  mkdir -p "${LOG_DIR}"
}

prepare_log_files() {
  ensure_log_dir
  BACKEND_LOG_FILE="${LOG_DIR}/backend.log"
  FRONTEND_LOG_FILE="${LOG_DIR}/frontend.log"
  : > "${BACKEND_LOG_FILE}"
  : > "${FRONTEND_LOG_FILE}"
}

print_log_paths() {
  [ -n "${BACKEND_LOG_FILE}" ] && kv "Backend log" "${BACKEND_LOG_FILE}"
  [ -n "${FRONTEND_LOG_FILE}" ] && kv "Frontend log" "${FRONTEND_LOG_FILE}"
}

show_log_tail() {
  local label="${1}"
  local path="${2}"

  [ -f "${path}" ] || return 0
  printf "\n"
  warn "${label} log tail:"
  tail -n 30 "${path}" || true
  printf "\n"
}

kill_process_tree() {
  local pid="${1:-}"
  if [ -z "${pid}" ]; then
    return 0
  fi

  if command -v taskkill.exe >/dev/null 2>&1; then
    taskkill.exe /PID "${pid}" /T /F >/dev/null 2>&1 || true
    return 0
  fi

  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -P "${pid}" >/dev/null 2>&1 || true
  fi
  kill "${pid}" >/dev/null 2>&1 || true
}

stop_matching_processes() {
  local kind="${1}"
  local pattern="${2}"

  if ! command -v powershell.exe >/dev/null 2>&1; then
    return 0
  fi

  powershell.exe -NoProfile -Command "
    Get-CimInstance Win32_Process |
      Where-Object { \$_.CommandLine -like '${pattern}' } |
      Select-Object -ExpandProperty ProcessId -Unique |
      ForEach-Object {
        try { Stop-Process -Id \$_ -Force -ErrorAction Stop } catch {}
      }
  " >/dev/null 2>&1 || true
}

find_listeners_on_port() {
  local port="${1}"

  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique" \
      2>/dev/null | tr -d '\r' | awk 'NF'
    return 0
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -ti TCP:"${port}" 2>/dev/null || true
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' | awk 'NF'
  fi
}

can_bind_port() {
  local port="${1}"

  if [ -z "${PYTHON:-}" ]; then
    return 1
  fi

  "${PYTHON}" - "${port}" <<'PY' >/dev/null 2>&1
import socket
import sys

port = int(sys.argv[1])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    sock.bind(("127.0.0.1", port))
except OSError:
    raise SystemExit(1)
finally:
    sock.close()

raise SystemExit(0)
PY
}

choose_backend_port() {
  local requested="${1}"
  local candidates=("${requested}" 8002 8010 8081 18001)

  for candidate in "${candidates[@]}"; do
    if can_bind_port "${candidate}"; then
      echo "${candidate}"
      return 0
    fi
  done

  echo ""
}

clear_port() {
  local port="${1}"
  local label="${2}"
  local pids

  if can_bind_port "${port}"; then
    return 0
  fi

  pids="$(find_listeners_on_port "${port}" | sort -u || true)"
  if [ -z "${pids}" ]; then
    return 0
  fi

  for _ in $(seq 1 12); do
    if can_bind_port "${port}"; then
      return 0
    fi

    pids="$(find_listeners_on_port "${port}" | sort -u || true)"
    if [ -z "${pids}" ]; then
      return 0
    fi

    warn "Stopping existing ${label} listener(s) on port ${port}: $(echo "${pids}" | paste -sd ', ' -)"
    while IFS= read -r pid; do
      [ -n "${pid}" ] || continue
      kill_process_tree "${pid}"
    done <<< "${pids}"

    sleep 1
  done

  return 1
}

cleanup() {
  if [ "${CLEANUP_DONE}" -eq 1 ]; then
    return 0
  fi
  CLEANUP_DONE=1

  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    info "Stopping backend (PID ${BACKEND_PID})..."
    kill_process_tree "${BACKEND_PID}"
  fi
  if [ -n "${FRONTEND_PID}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    info "Stopping frontend (PID ${FRONTEND_PID})..."
    kill_process_tree "${FRONTEND_PID}"
  fi
}

trap cleanup EXIT INT TERM

wait_for_db() {
  local db_path="${BACKEND_DIR}/purvex.db"
  for _ in $(seq 1 30); do
    if [ -f "${db_path}" ]; then return 0; fi
    sleep 0.5
  done
  return 1
}

bootstrap_admin() {
  local marker="${ROOT_DIR}/.purvex_admin_bootstrapped"
  if [ -f "${marker}" ]; then return; fi

  cd "${BACKEND_DIR}"
  export PYTHONPATH="${BACKEND_DIR}"

  if [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
  elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
  fi

  if wait_for_db; then
    info "First-run admin setup..."
    if $PYTHON scripts/create_admin.py --only-if-missing; then
      touch "${marker}"
      info "Admin created. Use those credentials to sign in."
    else
      warn "Admin bootstrap failed; will retry next start."
    fi
  fi
}

start_backend() {
  cd "${BACKEND_DIR}"
  export PYTHONPATH="${BACKEND_DIR}"

  if [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
  elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
  fi

  local uvicorn_level="${UVICORN_LOG_LEVEL:-warning}"
  if [ "${PURVEX_ATTACH_STARTUP_LOGS:-0}" = "1" ] || [ -z "${BACKEND_LOG_FILE}" ]; then
    uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --log-level "${uvicorn_level}" &
  else
    uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --log-level "${uvicorn_level}" \
      >>"${BACKEND_LOG_FILE}" 2>&1 &
  fi
  BACKEND_PID=$!
}

wait_for_backend_ready() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_frontend() {
  cd "${FRONTEND_DIR}"
  if [ ! -d "node_modules" ]; then
    fail "Frontend dependencies missing. Run: ./scripts/purvex.sh --setup"
  fi

  # Build production bundle if not already built
  if [ ! -d ".next" ]; then
    info "Building frontend (first run)..."
    npx next build --webpack
  fi

  if [ "${PURVEX_ATTACH_STARTUP_LOGS:-0}" = "1" ] || [ -z "${FRONTEND_LOG_FILE}" ]; then
    PORT="${FRONTEND_PORT}" npx next start -p "${FRONTEND_PORT}" -H 127.0.0.1 &
  else
    PORT="${FRONTEND_PORT}" npx next start -p "${FRONTEND_PORT}" -H 127.0.0.1 \
      >>"${FRONTEND_LOG_FILE}" 2>&1 &
  fi
  FRONTEND_PID=$!
}

start_frontend_dev() {
  cd "${FRONTEND_DIR}"
  if [ ! -d "node_modules" ]; then
    fail "Frontend dependencies missing. Run: ./scripts/purvex.sh --setup"
  fi

  rm -rf .next
  npx next dev --webpack -p "${FRONTEND_PORT}" -H 127.0.0.1 &
  FRONTEND_PID=$!
}

wait_for_frontend_ready() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

run_dev() {
  export PURVEX_QUIET_RUNTIME=1
  check_python
  check_node
  load_env

  stop_matching_processes "backend" "*PurveX*backend*uvicorn*"
  stop_matching_processes "frontend" "*PurveX*frontend*next*dev*"
  stop_matching_processes "frontend" "*PurveX*frontend*node_modules*next*dist*bin*next*dev*"

  if ! can_bind_port "${BACKEND_PORT}"; then
    local chosen_backend_port
    chosen_backend_port="$(choose_backend_port "${BACKEND_PORT}")"
    if [ -z "${chosen_backend_port}" ]; then
      fail "Could not find a free backend port. Set BACKEND_PORT manually and retry."
    fi
    if [ "${chosen_backend_port}" != "${BACKEND_PORT}" ]; then
      warn "Port ${BACKEND_PORT} busy, using ${chosen_backend_port}."
      BACKEND_PORT="${chosen_backend_port}"
    fi
  fi

  clear_port "${FRONTEND_PORT}" "frontend"
  export NEXT_PUBLIC_API_URL="http://127.0.0.1:${BACKEND_PORT}"

  info "Starting PurveX (dev)..."
  start_backend
  if ! wait_for_backend_ready; then
    fail "API did not start."
  fi
  bootstrap_admin
  start_frontend_dev
  unset PURVEX_QUIET_RUNTIME

  print_urls "http://127.0.0.1:${BACKEND_PORT}" "http://127.0.0.1:${FRONTEND_PORT}"

  wait
}

run_start() {
  export PURVEX_QUIET_RUNTIME=1
  check_python
  check_node
  load_env
  prepare_log_files

  stop_matching_processes "backend" "*PurveX*backend*uvicorn*"
  stop_matching_processes "frontend" "*PurveX*frontend*next*start*"
  stop_matching_processes "frontend" "*PurveX*frontend*node_modules*next*dist*bin*next*start*"
  stop_matching_processes "frontend" "*PurveX*frontend*next*dev*"
  stop_matching_processes "frontend" "*PurveX*frontend*node_modules*next*dist*bin*next*dev*"

  if ! can_bind_port "${BACKEND_PORT}"; then
    local chosen_backend_port
    chosen_backend_port="$(choose_backend_port "${BACKEND_PORT}")"
    if [ -z "${chosen_backend_port}" ]; then
      fail "Could not find a free backend port. Set BACKEND_PORT manually and retry."
    fi
    if [ "${chosen_backend_port}" != "${BACKEND_PORT}" ]; then
      warn "Port ${BACKEND_PORT} busy, using ${chosen_backend_port}."
      BACKEND_PORT="${chosen_backend_port}"
    fi
  fi

  clear_port "${FRONTEND_PORT}" "frontend"
  export NEXT_PUBLIC_API_URL="http://127.0.0.1:${BACKEND_PORT}"

  info "Starting PurveX..."
  start_backend
  if ! wait_for_backend_ready; then
    show_log_tail "Backend" "${BACKEND_LOG_FILE}"
    fail "API did not start."
  fi
  bootstrap_admin
  start_frontend
  if ! wait_for_frontend_ready; then
    show_log_tail "Frontend" "${FRONTEND_LOG_FILE}"
    fail "Web UI did not start."
  fi
  unset PURVEX_QUIET_RUNTIME

  print_urls "http://127.0.0.1:${BACKEND_PORT}" "http://127.0.0.1:${FRONTEND_PORT}"
  print_log_paths

  wait
}

# ── Rebuild ──────────────────────────────────────────────────────────────────

run_rebuild() {
  info "Rebuilding PurveX..."
  check_python
  check_node
  load_env

  # Backend: reinstall deps
  info "Reinstalling backend dependencies..."
  cd "${BACKEND_DIR}"
  if [ -d "venv" ]; then
    if [ -f "venv/Scripts/activate" ]; then
      source venv/Scripts/activate
    elif [ -f "venv/bin/activate" ]; then
      source venv/bin/activate
    fi
    python -m pip install --upgrade pip -q
    python -m pip install -r "${ROOT_DIR}/requirements.txt" -q
    if [ -f "${BACKEND_DIR}/requirements-dev.txt" ]; then
      python -m pip install -r "${BACKEND_DIR}/requirements-dev.txt" -q
    fi
  else
    setup_backend
  fi

  # Frontend: clean + rebuild production bundle
  info "Rebuilding frontend..."
  cd "${FRONTEND_DIR}"
  rm -rf .next
  npm install
  info "Building production bundle..."
  npx next build --webpack
  info "Rebuild complete. Run: ./scripts/purvex.sh --start"
}

# ── Help ─────────────────────────────────────────────────────────────────────

show_help() {
  cat <<'EOF'
Usage: ./scripts/purvex.sh <command>

  --setup     Install dependencies (first time)
  --start     Start PurveX
  --rebuild   Rebuild everything from scratch
  --help      Show this help
EOF
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
  --start)   run_start   ;;
  --dev)     run_dev     ;;
  --setup)   run_setup   ;;
  --rebuild) run_rebuild ;;
  --help|-h) show_help   ;;
  *)
    show_help
    exit 1
    ;;
esac
