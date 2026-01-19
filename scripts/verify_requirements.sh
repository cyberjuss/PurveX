#!/usr/bin/env bash
# PurveX dependency check (Linux)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

status=0
missing_tools=()

echo "Checking required tooling..."

if command -v python3 >/dev/null 2>&1; then
  pyver=$(python3 -V 2>&1 | awk '{print $2}')
  pymajor=$(echo "$pyver" | cut -d. -f1)
  pyminor=$(echo "$pyver" | cut -d. -f2)
  if [ "$pymajor" -lt 3 ] || { [ "$pymajor" -eq 3 ] && [ "$pyminor" -lt 11 ]; }; then
    echo "Python 3.11+ required. Found: $pyver"
    status=1
  else
    echo "Python: $pyver"
  fi
else
  echo "python3 not found."
  echo "Download Python 3.11+: https://www.python.org/downloads/"
  missing_tools+=("python3")
  status=1
fi

if command -v node >/dev/null 2>&1; then
  nodever=$(node -v | sed 's/^v//')
  nodemajor=$(echo "$nodever" | cut -d. -f1)
  if [ "$nodemajor" -lt 18 ]; then
    echo "Node.js 18+ required. Found: $nodever"
    status=1
  else
    echo "Node.js: $nodever"
  fi
else
  echo "node not found."
  echo "Download Node.js 18+: https://nodejs.org/en/download/"
  missing_tools+=("node")
  status=1
fi

if command -v npm >/dev/null 2>&1; then
  echo "npm: $(npm -v)"
else
  echo "npm not found."
  echo "npm is installed with Node.js. Download: https://nodejs.org/en/download/"
  missing_tools+=("npm")
  status=1
fi

if [ "$status" -ne 0 ]; then
  if [ "${#missing_tools[@]}" -gt 0 ]; then
    echo "Missing tools: ${missing_tools[*]}"
  fi
  echo "Install the missing tools and rerun this script."
  exit "$status"
fi

echo "All required tools are available."

echo "Installing Python dependencies..."
python3 -m pip install --upgrade pip
python3 -m pip install -r "${ROOT_DIR}/requirements.txt"

if command -v safety >/dev/null 2>&1; then
  echo "Running Python dependency scan (safety)..."
  (cd backend && safety check --json || safety check || true)
else
  echo "safety not installed (optional). Install with: pip install safety"
fi

if command -v npm >/dev/null 2>&1; then
  echo "Running Node dependency audit..."
  (cd frontend && npm audit --audit-level=moderate || true)
fi
