#!/bin/bash
# One-liner PurveX Agent Registration
# Copy and paste this entire script onto your lab/sandbox machine
#
# Usage: Replace YOUR_API_URL and YOUR_TOKEN, then run:
# curl -sSL https://raw.githubusercontent.com/your-repo/purvex/main/agent/register_agent_one_liner.sh | bash

# ===== CONFIGURATION - EDIT THESE VALUES =====
PURVEX_API_URL="${PURVEX_API_URL:-http://localhost:8000}"
PURVEX_API_TOKEN="${PURVEX_API_TOKEN:-YOUR_TOKEN_HERE}"
PURVEX_ENV="${PURVEX_ENV:-lab}"
# ==============================================

# Auto-detect hostname and IP
HOSTNAME=$(hostname 2>/dev/null || echo "unknown")
LOCAL_IP=$(ip route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}' || ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1 || echo "127.0.0.1")
USERNAME="${USER:-purvex}"

echo "Registering with PurveX..."
echo "Hostname: $HOSTNAME | IP: $LOCAL_IP | Env: $PURVEX_ENV"

curl -s -X POST "${PURVEX_API_URL%/}/api/settings/environment-runners" \
  -H "Authorization: Bearer $PURVEX_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"environment_name\":\"$PURVEX_ENV\",\"runner_type\":\"SSH\",\"hostname\":\"$HOSTNAME\",\"port\":22,\"username\":\"$USERNAME\",\"auth_method\":\"key\",\"allowed_test_types\":\"[\\\"Atomic only\\\"]\",\"max_concurrent_tests\":1,\"heartbeat_interval_seconds\":5,\"alert_offline_minutes\":5}" \
  && echo -e "\n✅ Registration successful!" || echo -e "\n❌ Registration failed!"
