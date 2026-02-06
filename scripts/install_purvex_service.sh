#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_SRC="${ROOT_DIR}/scripts/purvex.service"
SERVICE_DST="/etc/systemd/system/purvex.service"

if [ ! -f "${SERVICE_SRC}" ]; then
  echo "Service file not found: ${SERVICE_SRC}"
  exit 1
fi

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root (sudo)."
  exit 1
fi

cp "${SERVICE_SRC}" "${SERVICE_DST}"
systemctl daemon-reload
systemctl enable purvex
systemctl restart purvex
systemctl status purvex --no-pager
