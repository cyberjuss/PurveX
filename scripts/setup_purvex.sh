#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIN_NODE_VERSION="20.9.0"
MIN_NODE_MAJOR="20"
MIN_NODE_MINOR="9"
MIN_NODE_PATCH="0"
OLLAMA_MODEL_DEFAULT="${OLLAMA_MODEL_NAME:-gemma2:2b}"
ATOMIC_DATA_DIR="${PURVEX_ATOMIC_DATA_DIR:-${HOME}/.purvex/atomic-red-team}"
ATOMIC_TARBALL_URL="${PURVEX_ATOMIC_TARBALL_URL:-https://github.com/redcanaryco/atomic-red-team/archive/refs/heads/master.tar.gz}"

echo "Checking required tooling..."

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.11+ and retry."
  exit 1
fi

pyver="$(python3 -V 2>&1 | awk '{print $2}')"
pymajor="$(echo "$pyver" | cut -d. -f1)"
pyminor="$(echo "$pyver" | cut -d. -f2)"
if [ "$pymajor" -lt 3 ] || { [ "$pymajor" -eq 3 ] && [ "$pyminor" -lt 11 ]; }; then
  echo "Python 3.11+ required. Found: $pyver"
  exit 1
fi

prompt_yes_no() {
  local prompt="$1"
  local reply=""
  read -r -p "${prompt} [y/N] " reply
  case "${reply}" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

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

install_nvm() {
  echo "nvm not found."
  if ! prompt_yes_no "Install nvm?"; then
    echo "Install nvm and rerun."
    return 1
  fi
  echo "Installing nvm..."
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl not found."
    if command -v apt-get >/dev/null 2>&1; then
      if prompt_yes_no "Install curl with apt-get?"; then
        sudo apt-get update
        sudo apt-get install -y curl
      else
        echo "Install curl and rerun."
        return 1
      fi
    else
      echo "Install curl and rerun."
      return 1
    fi
  fi
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${HOME}/.nvm/nvm.sh"
  fi
}

load_nvm() {
  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${HOME}/.nvm/nvm.sh"
  elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "/usr/local/opt/nvm/nvm.sh"
  fi
}

install_node_with_nvm() {
  load_nvm
  if ! command -v nvm >/dev/null 2>&1; then
    if ! install_nvm; then
      return 1
    fi
  fi

  if nvm ls "${MIN_NODE_VERSION}" >/dev/null 2>&1; then
    nvm use "${MIN_NODE_VERSION}" >/dev/null 2>&1
    return 0
  fi
  if nvm ls "${MIN_NODE_MAJOR}" >/dev/null 2>&1; then
    nvm use "${MIN_NODE_MAJOR}" >/dev/null 2>&1
    return 0
  fi

  echo "Installing Node.js ${MIN_NODE_VERSION} with nvm..."
  if ! nvm install "${MIN_NODE_VERSION}"; then
    echo "Exact version not available. Attempting latest Node.js ${MIN_NODE_MAJOR}.x..."
    nvm install "${MIN_NODE_MAJOR}"
  fi
  nvm use "${MIN_NODE_VERSION}" >/dev/null 2>&1 || nvm use "${MIN_NODE_MAJOR}" >/dev/null 2>&1 || true
  return 0
}

ensure_node() {
  load_nvm
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "node/npm not found. Attempting to install Node.js ${MIN_NODE_VERSION} with nvm..."
    if ! install_node_with_nvm; then
      echo "Node.js ${MIN_NODE_VERSION}+ required. Install with nvm or your package manager, then rerun."
      echo "nvm install ${MIN_NODE_VERSION}"
      exit 1
    fi
  fi

  nodever="$(node -v | sed 's/^v//')"
  if ! node_version_ok "${nodever}"; then
    echo "Node.js ${MIN_NODE_VERSION}+ required. Found: ${nodever}"
    echo "Attempting to install Node.js ${MIN_NODE_VERSION} with nvm..."
    if ! install_node_with_nvm; then
      exit 1
    fi
    nodever="$(node -v | sed 's/^v//')"
    if ! node_version_ok "${nodever}"; then
      echo "Node.js ${MIN_NODE_VERSION}+ still not available. Found: ${nodever}"
      echo "Run: nvm ls-remote | grep 'v${MIN_NODE_MAJOR}\\.'"
      exit 1
    fi
  fi
}

ensure_node

ensure_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    echo "Ollama found."
  else
    echo "Ollama not found."
    if prompt_yes_no "Install Ollama now?"; then
      if ! command -v curl >/dev/null 2>&1; then
        echo "curl not found."
        if command -v apt-get >/dev/null 2>&1; then
          if prompt_yes_no "Install curl with apt-get?"; then
            sudo apt-get update
            sudo apt-get install -y curl
          else
            echo "Install curl and rerun."
            return 1
          fi
        else
          echo "Install curl and rerun."
          return 1
        fi
      fi
      echo "Installing Ollama..."
      curl -fsSL https://ollama.com/install.sh | sh
    else
      echo "Skipping Ollama installation."
      return 0
    fi
  fi

  if prompt_yes_no "Start Ollama and pull model (${OLLAMA_MODEL_DEFAULT}) now?"; then
    if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      echo "Starting Ollama..."
      (ollama serve >/dev/null 2>&1 &)
      for _ in {1..20}; do
        if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
          break
        fi
        sleep 1
      done
    fi
    echo "Pulling Ollama model: ${OLLAMA_MODEL_DEFAULT}"
    ollama pull "${OLLAMA_MODEL_DEFAULT}" || true
  fi
}

ensure_atomic_catalog() {
  if [ -d "${ATOMIC_DATA_DIR}/atomics" ]; then
    echo "Atomic catalog already present at ${ATOMIC_DATA_DIR}."
    return 0
  fi

  if ! prompt_yes_no "Download Atomic Red Team catalog now? (~2-5GB)"; then
    echo "Skipping Atomic catalog download."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl not found."
    if command -v apt-get >/dev/null 2>&1; then
      if prompt_yes_no "Install curl with apt-get?"; then
        sudo apt-get update
        sudo apt-get install -y curl
      else
        echo "Install curl and rerun."
        return 1
      fi
    else
      echo "Install curl and rerun."
      return 1
    fi
  fi

  tmp_dir="$(mktemp -d)"
  tar_path="${tmp_dir}/atomic-red-team.tar.gz"
  echo "Downloading Atomic Red Team catalog..."
  curl -L --retry 5 --retry-delay 2 -o "${tar_path}" "${ATOMIC_TARBALL_URL}"
  tar -xzf "${tar_path}" -C "${tmp_dir}"
  extracted_dir="$(find "${tmp_dir}" -maxdepth 1 -type d -name 'atomic-red-team-*' | head -n 1)"
  if [ -z "${extracted_dir}" ]; then
    echo "Atomic catalog download did not contain expected folder."
    return 1
  fi
  mkdir -p "$(dirname "${ATOMIC_DATA_DIR}")"
  if [ -d "${ATOMIC_DATA_DIR}" ]; then
    if prompt_yes_no "Replace existing Atomic catalog at ${ATOMIC_DATA_DIR}?"; then
      rm -rf "${ATOMIC_DATA_DIR}"
    else
      echo "Keeping existing catalog."
      return 0
    fi
  fi
  mv "${extracted_dir}" "${ATOMIC_DATA_DIR}"
  echo "Atomic catalog installed at ${ATOMIC_DATA_DIR}."
}

ensure_atomic_catalog

echo "Setting up backend venv and dependencies..."
cd "${ROOT_DIR}/backend"
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
# shellcheck disable=SC1091
if [ ! -f "venv/bin/activate" ]; then
  echo "Python venv missing."
  if command -v apt-get >/dev/null 2>&1; then
    if prompt_yes_no "Install python3-venv with apt-get?"; then
      sudo apt-get update
      sudo apt-get install -y python3-venv
      python3 -m venv venv
    else
      echo "Install python3-venv and rerun."
      exit 1
    fi
  else
    echo "Install python3-venv and rerun."
    exit 1
  fi
fi
# shellcheck disable=SC1091
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r "${ROOT_DIR}/requirements.txt"
deactivate

echo "Setting up frontend dependencies..."
cd "${ROOT_DIR}/frontend"
npm install

ensure_ollama

echo "Setup complete. Run: ${ROOT_DIR}/scripts/start_purvex.sh"
