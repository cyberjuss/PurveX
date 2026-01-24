#!/bin/bash
# PurveX Agent Registration Script (Bash version)
# 
# This script can be copied and pasted onto any Linux/Unix sandbox or lab computer.
# It will automatically detect the machine's hostname/IP and register itself
# with the PurveX system as a test runner.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/your-repo/purvex/main/agent/register_agent.sh | bash -s -- --api-url http://your-server:8000 --token YOUR_TOKEN --env lab
#
# Or download and run:
#   wget https://raw.githubusercontent.com/your-repo/purvex/main/agent/register_agent.sh
#   chmod +x register_agent.sh
#   ./register_agent.sh --api-url http://your-server:8000 --token YOUR_TOKEN --env lab

set -e

# Default values
API_URL="${PURVEX_API_URL:-http://127.0.0.1:8001}"
API_TOKEN="${PURVEX_API_TOKEN:-}"
ENV="${PURVEX_ENV:-lab}"
ENV_SET="false"
if [ -n "${PURVEX_ENV:-}" ]; then
    ENV_SET="true"
fi
HOSTNAME="${PURVEX_HOSTNAME:-}"
PORT="${PURVEX_PORT:-22}"
USERNAME="${PURVEX_USERNAME:-${USER:-purvex}}"

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --token)
            API_TOKEN="$2"
            shift 2
            ;;
        --env)
            ENV="$2"
            ENV_SET="true"
            shift 2
            ;;
        --hostname)
            HOSTNAME="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --username)
            USERNAME="$2"
            shift 2
            ;;
        --help)
            echo "PurveX Agent Registration Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --api-url URL     PurveX API base URL (default: http://localhost:8000)"
            echo "  --token TOKEN     API authentication token (required)"
            echo "  --admin-token TOKEN    Admin JWT to mint a registration token"
            echo "  --env ENV         Environment name: lab, dev, or prod (default: lab)"
            echo "  --hostname NAME   Custom hostname (auto-detected if not provided)"
            echo "  --port PORT       SSH port (default: 22)"
            echo "  --username USER   SSH username (default: current user)"
            echo ""
            echo "Environment variables:"
            echo "  PURVEX_API_URL    API base URL"
            echo "  PURVEX_API_TOKEN  API token"
            echo "  PURVEX_ADMIN_TOKEN     Admin JWT to mint a registration token"
            echo "  PURVEX_ENV        Environment name"
            echo "  PURVEX_HOSTNAME   Custom hostname"
            echo "  PURVEX_PORT       SSH port"
            echo "  PURVEX_USERNAME   SSH username"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Check if curl is available
if ! command -v curl >/dev/null 2>&1; then
    echo "❌ ERROR: 'curl' is required but not installed."
    echo "   Install it with: apt-get install curl (Debian/Ubuntu) or yum install curl (RHEL/CentOS)"
    exit 1
fi

api_base="${API_URL%/}"

if [ -z "$API_TOKEN" ]; then
    read -r -p "PurveX API URL [${API_URL}]: " input_api
    if [ -n "$input_api" ]; then
        API_URL="$input_api"
        api_base="${API_URL%/}"
    fi
    read -r -p "Environment [lab/dev/prod] (${ENV}): " input_env
    if [ -n "$input_env" ]; then
        ENV="$input_env"
    fi
    read -r -s -p "Registration token (paste and press Enter): " API_TOKEN
    echo ""
    if [ -z "$API_TOKEN" ]; then
        read -r -s -p "Registration token (required): " API_TOKEN
        echo ""
    fi
fi

# Prompt for environment if not explicitly set
if [ "$ENV_SET" = "false" ]; then
    read -r -p "Environment [lab/dev/prod] (${ENV}): " input_env
    if [ -n "$input_env" ]; then
        ENV="$input_env"
    fi
fi

# Validate required arguments
if [ -z "$API_TOKEN" ]; then
    echo "❌ ERROR: Registration token is required."
    echo "   Provide it via --token or set PURVEX_API_TOKEN."
    exit 1
fi

# Auto-detect hostname if not provided
if [ -z "$HOSTNAME" ]; then
    HOSTNAME=$(hostname 2>/dev/null || echo "unknown")
fi

# Get local IP address
get_local_ip() {
    if command -v ip >/dev/null 2>&1; then
        ip route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}' || echo "127.0.0.1"
    elif command -v ifconfig >/dev/null 2>&1; then
        ifconfig | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1 || echo "127.0.0.1"
    else
        echo "127.0.0.1"
    fi
}

LOCAL_IP=$(get_local_ip)

# Get OS type
get_os_type() {
    if [ "$(uname)" = "Linux" ]; then
        echo "linux"
    elif [ "$(uname)" = "Darwin" ]; then
        echo "macos"
    else
        echo "unknown"
    fi
}

OS_TYPE=$(get_os_type)

# Prepare registration data
REGISTRATION_DATA=$(cat <<EOF
{
  "environment_name": "$ENV",
  "runner_type": "SSH",
  "hostname": "$HOSTNAME",
  "port": $PORT,
  "username": "$USERNAME",
  "auth_method": "key",
  "allowed_test_types": "[\"Atomic only\"]",
  "max_concurrent_tests": 1,
  "heartbeat_interval_seconds": 5,
  "alert_offline_minutes": 5
}
EOF
)

# Display registration info
echo "Connecting to PurveX at: $API_URL"
echo "Registering agent:"
echo "  Hostname: $HOSTNAME"
echo "  IP Address: $LOCAL_IP"
echo "  OS Type: $OS_TYPE"
echo "  Environment: $ENV"
echo "  Port: $PORT"
echo "  Username: $USERNAME"
echo ""

# Make API request
URL="${api_base}/settings/environment-runners"
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$REGISTRATION_DATA" \
    "$URL" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check response
if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Successfully registered with PurveX!"
    RUNNER_ID=$(echo "$BODY" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$RUNNER_ID" ]; then
        echo "   Runner ID: $RUNNER_ID"
    fi
    echo "$BODY" | grep -o '"environment_name":"[^"]*"' | cut -d'"' -f4 | xargs -I {} echo "   Environment: {}"
    echo "$BODY" | grep -o '"hostname":"[^"]*"' | cut -d'"' -f4 | xargs -I {} echo "   Hostname: {}"
elif [ "$HTTP_CODE" -eq 403 ]; then
    echo "❌ ERROR: Access denied. Check your API token and ensure you have admin privileges."
    exit 1
elif [ "$HTTP_CODE" -eq 409 ]; then
    echo "⚠️  WARNING: A runner with this hostname already exists."
    echo "   You may need to update the existing runner instead."
    exit 1
else
    echo "❌ ERROR: HTTP $HTTP_CODE"
    echo "   Response: $BODY"
    exit 1
fi
