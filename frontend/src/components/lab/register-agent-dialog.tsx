"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, CheckCircle2, Copy as CopyIcon, Download, Monitor, Terminal, Code } from "lucide-react";
import { apiFetch, getApiBaseCandidates } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { useToast } from "@/components/ui/toast";
import { UpgradeBanner, isUpgradeRequiredError } from "@/components/ui/upgrade-banner";
import { cn } from "@/lib/utils";

interface AgentRegistrationResponse {
  token?: string;
  expires_in_minutes?: number;
  public_key?: string;
}

interface EnvironmentRunnerConfig {
  environment_name: string;
  runner_type: string;
  hostname?: string;
  port: number;
  username?: string;
  auth_method: string;
  key_path?: string;
  ssh_host_key_sha256?: string;
  allowed_test_types: string;
  max_concurrent_tests: number;
  heartbeat_interval_seconds: number;
  alert_offline_minutes: number;
  owner_name?: string;
  owner_email?: string;
}

interface NavigatorWithMsSave extends Navigator {
  msSaveOrOpenBlob?: (blob: Blob, defaultName?: string) => boolean;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// Prefer an explicit public API URL when one is configured, otherwise fall
// back to the same candidate list the rest of the frontend uses.
function getDefaultRunnerApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const backendPort = process.env.NEXT_PUBLIC_BACKEND_PORT || "8001";
    return `${window.location.protocol}//${window.location.hostname}:${backendPort}`;
  }
  const candidates = getApiBaseCandidates();
  const directBase = candidates.find((candidate) => /^https?:\/\//.test(candidate));
  return directBase || "http://127.0.0.1:8001";
}

// Installer script templates. The registration token is never embedded —
// supplied at runtime via prompt, --token/-Token flag, or PURVEX_API_TOKEN
// env var. The public key IS embedded: it's not secret, and it's specific
// to the token that was active when the script was downloaded (PurveX
// mints a fresh ed25519 keypair per token so it can SSH back into the
// runner the moment registration completes — see
// routers/settings.py::generate_agent_registration_token). Re-download
// after regenerating the token if this script is more than one use old.
function getAgentScript(type: "bash" | "powershell" | "python", apiUrl: string, publicKey: string): string {
  if (type === "bash") {
    return `#!/bin/bash
# PurveX Agent Registration Script (Bash version)
# Copy and paste this onto any Linux/Unix sandbox or lab computer.

set -e

API_URL="${apiUrl}"
PUBLIC_KEY="${publicKey}"
TOKEN_PLACEHOLDER="__PURVEX_TOKEN_PLACEHOLDER__"
API_TOKEN="${"${PURVEX_API_TOKEN:-__PURVEX_TOKEN_PLACEHOLDER__}"}"
ENV="lab"
HOSTNAME=""
PORT="22"
USERNAME="${"${USER:-purvex}"}"
OWNER_NAME="${"${PURVEX_OWNER_NAME:-}"}"
OWNER_EMAIL="${"${PURVEX_OWNER_EMAIL:-}"}"
ENV_SET="false"
if [ -n "${"${PURVEX_ENV:-}"}" ]; then
    ENV_SET="true"
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url=*) API_URL="\${1#*=}"; shift 1 ;;
        --api-url) API_URL="$2"; shift 2 ;;
        --token) API_TOKEN="$2"; shift 2 ;;
        --env) ENV="$2"; ENV_SET="true"; shift 2 ;;
        --hostname) HOSTNAME="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --username) USERNAME="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if ! command -v curl >/dev/null 2>&1; then
    echo "❌ ERROR: 'curl' is required but not installed."
    echo "   Install it with: apt-get install curl (Debian/Ubuntu) or yum install curl (RHEL/CentOS)"
    exit 1
fi

api_base="\${API_URL%/}"

if [ -z "$API_TOKEN" ] || [ "$API_TOKEN" = "$TOKEN_PLACEHOLDER" ]; then
    read -r -p "PurveX API URL [\${API_URL}]: " input_api
    if [ -n "$input_api" ]; then
        API_URL="$input_api"
        api_base="\${API_URL%/}"
    fi
    read -r -p "Environment [lab/dev/prod] (\${ENV}): " input_env
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

if [ "$ENV_SET" = "false" ]; then
    read -r -p "Environment [lab/dev/prod] (\${ENV}): " input_env
    if [ -n "$input_env" ]; then
        ENV="$input_env"
    fi
fi

if [ -z "$API_TOKEN" ] || [ "$API_TOKEN" = "$TOKEN_PLACEHOLDER" ]; then
    echo "ERROR: Registration token is required."
    echo "   Please paste the token when prompted."
    exit 1
fi

if [ -z "$HOSTNAME" ]; then
    HOSTNAME=$(hostname 2>/dev/null || echo "unknown")
fi
if [ -z "$OWNER_NAME" ]; then
    OWNER_NAME="$USERNAME"
fi
read -r -p "Owner name [\${OWNER_NAME}]: " OWNER_NAME_INPUT
if [ -n "$OWNER_NAME_INPUT" ]; then
    OWNER_NAME="$OWNER_NAME_INPUT"
fi
read -r -p "Owner email (optional) [\${OWNER_EMAIL}]: " OWNER_EMAIL_INPUT
if [ -n "$OWNER_EMAIL_INPUT" ]; then
    OWNER_EMAIL="$OWNER_EMAIL_INPUT"
fi

get_local_ip() {
    if command -v ip >/dev/null 2>&1; then
        ip route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}' || echo "127.0.0.1"
    elif command -v ifconfig >/dev/null 2>&1; then
        ifconfig | grep -Eo 'inet (addr:)?([0-9]*\\.){3}[0-9]*' | grep -Eo '([0-9]*\\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1 || echo "127.0.0.1"
    else
        echo "127.0.0.1"
    fi
}

LOCAL_IP=$(get_local_ip)

# Authorize PurveX's public key so the backend can SSH back in to run
# tests, and report this host's own SSH host key fingerprint so PurveX can
# pin it (SSH MITM protection — registration is rejected without it).
provision_ssh_key() {
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
    touch "$HOME/.ssh/authorized_keys"
    chmod 600 "$HOME/.ssh/authorized_keys"
    grep -qxF "$PUBLIC_KEY" "$HOME/.ssh/authorized_keys" 2>/dev/null || echo "$PUBLIC_KEY" >> "$HOME/.ssh/authorized_keys"
}

compute_host_key_sha256() {
    for f in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do
        if [ -r "$f" ] && command -v ssh-keygen >/dev/null 2>&1; then
            ssh-keygen -lf "$f" -E sha256 2>/dev/null | awk '{print $2}'
            return 0
        fi
    done
    return 1
}

if [ -n "$PUBLIC_KEY" ]; then
    provision_ssh_key
fi
SSH_HOST_KEY_SHA256=$(compute_host_key_sha256 || true)
if [ -z "$SSH_HOST_KEY_SHA256" ]; then
    echo "❌ ERROR: Could not determine this host's SSH host key fingerprint."
    echo "   Checked /etc/ssh/ssh_host_{ed25519,ecdsa,rsa}_key.pub and required ssh-keygen on PATH."
    echo "   PurveX will not accept an SSH runner without a pinned host key."
    exit 1
fi

REGISTRATION_DATA=$(cat <<EOF
{
  "environment_name": "$ENV",
  "runner_type": "SSH",
  "hostname": "$HOSTNAME",
  "port": $PORT,
  "username": "$USERNAME",
  "os": "$(uname -s 2>/dev/null || echo "Unknown")",
  "ip_address": "$LOCAL_IP",
  "agent_version": "v1.0.0",
  "status": "online",
  "auth_method": "key",
  "ssh_host_key_sha256": "$SSH_HOST_KEY_SHA256",
  "allowed_test_types": "[\\"Atomic only\\"]",
  "max_concurrent_tests": 1,
  "heartbeat_interval_seconds": 5,
  "alert_offline_minutes": 5,
  "owner_name": "$OWNER_NAME",
  "owner_email": "$OWNER_EMAIL"
}
EOF
)

echo "Connecting to PurveX at: $API_URL"
echo "Registering agent:"
echo "  Hostname: $HOSTNAME"
echo "  IP Address: $LOCAL_IP"
echo "  Environment: $ENV"
echo "  Owner: $OWNER_NAME"
echo ""

URL="\${api_base}/settings/environment-runners"
RESPONSE=$(curl -s -w "\\n%{http_code}" -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d "$REGISTRATION_DATA" "$URL" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Successfully registered with PurveX!"
    RUNNER_ID=$(echo "$BODY" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$RUNNER_ID" ]; then
        echo "   Runner ID: $RUNNER_ID"
    fi
    RUNNER_TOKEN=$(echo "$BODY" | grep -o '"runner_token":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$RUNNER_TOKEN" ]; then
        API_TOKEN="$RUNNER_TOKEN"
    fi
    if [ -n "$RUNNER_ID" ]; then
        OS_NAME=$(uname -s 2>/dev/null || echo "Unknown")
        HB_PAYLOAD=$(cat <<EOF
{
  "os": "$OS_NAME",
  "ip_address": "$LOCAL_IP",
  "agent_version": "v1.0.0",
  "status": "online"
}
EOF
)
        curl -s -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
          -d "$HB_PAYLOAD" "\${API_URL%/}/agent/heartbeat" >/dev/null 2>&1 || true
        if command -v systemctl >/dev/null 2>&1; then
            HB_SCRIPT="/usr/local/bin/purvex-agent-heartbeat.sh"
            HB_UNIT="/etc/systemd/system/purvex-agent-heartbeat.service"
            sudo tee "$HB_SCRIPT" >/dev/null <<EOF
#!/bin/bash
API_URL="\${API_URL}"
API_TOKEN="\${API_TOKEN}"
RUNNER_ID="\${RUNNER_ID}"
while true; do
  OS_NAME=\$(uname -s 2>/dev/null || echo "Unknown")
  LOCAL_IP=\$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
  curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \\
    -d "{\"os\":\"\${OS_NAME}\",\"ip_address\":\"\${LOCAL_IP}\",\"agent_version\":\"v1.0.0\",\"status\":\"online\"}" \\
    "\${API_URL%/}/agent/heartbeat" >/dev/null 2>&1 || true
  CMD_JSON=$(curl -s -H "Authorization: Bearer \${API_TOKEN}" "\${API_URL%/}/agent/commands/next" || true)
  CMD_ID=$(echo "$CMD_JSON" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
  CMD_TYPE=$(echo "$CMD_JSON" | grep -o '"command_type":"[^"]*"' | cut -d'"' -f4)
  if [ "$CMD_TYPE" = "STOP_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \
      -d "{\"status\":\"completed\",\"message\":\"Agent stopped\"}" \
      "\${API_URL%/}/agent/commands/\${CMD_ID}/ack" >/dev/null 2>&1 || true
    systemctl disable --now purvex-agent-heartbeat.service >/dev/null 2>&1 || true
    exit 0
  fi
  if [ "$CMD_TYPE" = "PAUSE_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \
      -d "{\"status\":\"completed\",\"message\":\"Agent paused\"}" \
      "\${API_URL%/}/agent/commands/\${CMD_ID}/ack" >/dev/null 2>&1 || true
  fi
  if [ "$CMD_TYPE" = "RESUME_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \
      -d "{\"status\":\"completed\",\"message\":\"Agent resumed\"}" \
      "\${API_URL%/}/agent/commands/\${CMD_ID}/ack" >/dev/null 2>&1 || true
  fi
  sleep 5
done
EOF
            sudo chmod +x "$HB_SCRIPT"
            sudo tee "$HB_UNIT" >/dev/null <<EOF
[Unit]
Description=PurveX Agent Heartbeat
After=network-online.target

[Service]
Type=simple
ExecStart=$HB_SCRIPT
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
            sudo systemctl daemon-reload
            sudo systemctl enable --now purvex-agent-heartbeat.service >/dev/null 2>&1 || true
        fi
    fi
elif [ "$HTTP_CODE" -eq 403 ]; then
    echo "❌ ERROR: Access denied. Check your API token and ensure you have admin privileges."
    exit 1
elif [ "$HTTP_CODE" -eq 409 ]; then
    echo "⚠️  WARNING: A runner with this hostname already exists."
    exit 1
else
    if [ "$HTTP_CODE" -eq 404 ]; then
        URL="\${api_base}/api/settings/environment-runners"
        RESPONSE=$(curl -s -w "\\n%{http_code}" -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d "$REGISTRATION_DATA" "$URL" 2>&1)

        HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
        BODY=$(echo "$RESPONSE" | sed '$d')

        if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 200 ]; then
            echo "✅ Successfully registered with PurveX!"
            RUNNER_ID=$(echo "$BODY" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
            if [ -n "$RUNNER_ID" ]; then
                echo "   Runner ID: $RUNNER_ID"
            fi
            RUNNER_TOKEN=$(echo "$BODY" | grep -o '"runner_token":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$RUNNER_TOKEN" ]; then
                API_TOKEN="$RUNNER_TOKEN"
            fi
            if [ -n "$RUNNER_ID" ]; then
                OS_NAME=$(uname -s 2>/dev/null || echo "Unknown")
                HB_PAYLOAD=$(cat <<EOF
{
  "os": "$OS_NAME",
  "ip_address": "$LOCAL_IP",
  "agent_version": "v1.0.0",
  "status": "online"
}
EOF
)
                curl -s -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
                  -d "$HB_PAYLOAD" "\${API_URL%/}/agent/heartbeat" >/dev/null 2>&1 || true
                if command -v systemctl >/dev/null 2>&1; then
                    HB_SCRIPT="/usr/local/bin/purvex-agent-heartbeat.sh"
                    HB_UNIT="/etc/systemd/system/purvex-agent-heartbeat.service"
                    sudo tee "$HB_SCRIPT" >/dev/null <<EOF
#!/bin/bash
API_URL="\${API_URL}"
API_TOKEN="\${API_TOKEN}"
RUNNER_ID="\${RUNNER_ID}"
while true; do
  OS_NAME=\$(uname -s 2>/dev/null || echo "Unknown")
  LOCAL_IP=\$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
  curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \\
    -d "{\"os\":\"\${OS_NAME}\",\"ip_address\":\"\${LOCAL_IP}\",\"agent_version\":\"v1.0.0\",\"status\":\"online\"}" \\
    "\${API_URL%/}/agent/heartbeat" >/dev/null 2>&1 || true
  CMD_JSON=$(curl -s -H "Authorization: Bearer \${API_TOKEN}" "\${API_URL%/}/agent/commands/next" || true)
  CMD_ID=$(echo "$CMD_JSON" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
  CMD_TYPE=$(echo "$CMD_JSON" | grep -o '"command_type":"[^"]*"' | cut -d'"' -f4)
  if [ "$CMD_TYPE" = "STOP_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \
      -d "{\"status\":\"completed\",\"message\":\"Agent stopped\"}" \
      "\${API_URL%/}/agent/commands/\${CMD_ID}/ack" >/dev/null 2>&1 || true
    systemctl disable --now purvex-agent-heartbeat.service >/dev/null 2>&1 || true
    exit 0
  fi
  if [ "$CMD_TYPE" = "PAUSE_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \
      -d "{\"status\":\"completed\",\"message\":\"Agent paused\"}" \
      "\${API_URL%/}/agent/commands/\${CMD_ID}/ack" >/dev/null 2>&1 || true
  fi
  if [ "$CMD_TYPE" = "RESUME_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${API_TOKEN}" -H "Content-Type: application/json" \
      -d "{\"status\":\"completed\",\"message\":\"Agent resumed\"}" \
      "\${API_URL%/}/agent/commands/\${CMD_ID}/ack" >/dev/null 2>&1 || true
  fi
  sleep 5
done
EOF
                    sudo chmod +x "$HB_SCRIPT"
                    sudo tee "$HB_UNIT" >/dev/null <<EOF
[Unit]
Description=PurveX Agent Heartbeat
After=network-online.target

[Service]
Type=simple
ExecStart=$HB_SCRIPT
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
                    sudo systemctl daemon-reload
                    sudo systemctl enable --now purvex-agent-heartbeat.service >/dev/null 2>&1 || true
                fi
            fi
            exit 0
        fi
    fi
    echo "❌ ERROR: HTTP $HTTP_CODE"
    echo "   Response: $BODY"
    exit 1
fi`;
  } else if (type === "powershell") {
    return `# PurveX Agent Registration Script (PowerShell version)
# Copy and paste this onto any Windows sandbox or lab computer.

param(
    [string]$ApiUrl = "${apiUrl}",
    [string]$PublicKey = "${publicKey}",
    [string]$Token = $(if ($env:PURVEX_API_TOKEN) { $env:PURVEX_API_TOKEN } else { "__PURVEX_TOKEN_PLACEHOLDER__" }),
    [string]$Env = "lab",
    [string]$Hostname = $env:COMPUTERNAME,
    [int]$Port = 22,
    [string]$Username = $env:USERNAME,
    [string]$OwnerName = $env:PURVEX_OWNER_NAME,
    [string]$OwnerEmail = $env:PURVEX_OWNER_EMAIL
)

$envProvided = $PSBoundParameters.ContainsKey('Env') -or (-not [string]::IsNullOrEmpty($env:PURVEX_ENV))
if (-not $envProvided) {
    $inputEnv = Read-Host "Environment [lab/dev/prod] ($Env)"
    if (-not [string]::IsNullOrEmpty($inputEnv)) {
        $Env = $inputEnv
    }
}

$TokenPlaceholder = "__PURVEX_TOKEN_PLACEHOLDER__"
if ([string]::IsNullOrEmpty($Token) -or $Token -eq $TokenPlaceholder) {
    $inputApi = Read-Host "PurveX API URL [$ApiUrl]"
    if (-not [string]::IsNullOrEmpty($inputApi)) {
        $ApiUrl = $inputApi
    }
    $Token = Read-Host "Registration token"
}

if ([string]::IsNullOrEmpty($Token) -or $Token -eq $TokenPlaceholder) {
    Write-Host "❌ ERROR: Registration token is required." -ForegroundColor Red
    Write-Host "   Provide it via -Token or set PURVEX_API_TOKEN." -ForegroundColor Yellow
    exit 1
}

if ([string]::IsNullOrEmpty($OwnerName)) {
    $OwnerName = $Username
}
$ownerNameInput = Read-Host "Owner name (default: $OwnerName)"
if (-not [string]::IsNullOrEmpty($ownerNameInput)) {
    $OwnerName = $ownerNameInput
}
$ownerEmailInput = Read-Host "Owner email (optional)"
if (-not [string]::IsNullOrEmpty($ownerEmailInput)) {
    $OwnerEmail = $ownerEmailInput
}

function Get-LocalIP {
    $ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
    if ($ipAddresses) {
        return $ipAddresses[0].IPAddress
    }
    return "127.0.0.1"
}

$LocalIP = Get-LocalIP

# Authorize PurveX's public key so the backend can SSH back in to run
# tests, and report this host's own SSH host key fingerprint so PurveX can
# pin it (SSH MITM protection — registration is rejected without it).
function Get-HostKeySha256 {
    $candidates = @(
        (Join-Path $env:ProgramData "ssh\\ssh_host_ed25519_key.pub"),
        (Join-Path $env:ProgramData "ssh\\ssh_host_ecdsa_key.pub"),
        (Join-Path $env:ProgramData "ssh\\ssh_host_rsa_key.pub")
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) {
            $parts = (Get-Content $path -Raw).Trim() -split '\\s+'
            if ($parts.Length -ge 2) {
                $blob = [Convert]::FromBase64String($parts[1])
                $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($blob)
                $b64 = [Convert]::ToBase64String($hash).TrimEnd('=')
                return "SHA256:$b64"
            }
        }
    }
    return $null
}

function Add-PurveXAuthorizedKey {
    param([string]$Key)
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    # Windows OpenSSH ignores the per-user authorized_keys file for accounts
    # in the Administrators group and requires this ProgramData file
    # instead, with a locked-down ACL.
    if ($isAdmin) {
        $target = Join-Path $env:ProgramData "ssh\\administrators_authorized_keys"
    } else {
        $target = Join-Path $env:USERPROFILE ".ssh\\authorized_keys"
    }
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    $existing = if (Test-Path $target) { Get-Content $target } else { @() }
    if ($existing -notcontains $Key) {
        Add-Content -Path $target -Value $Key
    }
    if ($isAdmin) {
        icacls $target /inheritance:r | Out-Null
        icacls $target /grant "SYSTEM:F" /grant "Administrators:F" | Out-Null
    }
}

if (-not [string]::IsNullOrEmpty($PublicKey)) {
    Add-PurveXAuthorizedKey -Key $PublicKey
}
$SshHostKeySha256 = Get-HostKeySha256
if ([string]::IsNullOrEmpty($SshHostKeySha256)) {
    Write-Host "❌ ERROR: Could not determine this host's SSH host key fingerprint." -ForegroundColor Red
    Write-Host "   Checked ProgramData\\ssh\\ssh_host_{ed25519,ecdsa,rsa}_key.pub - is the OpenSSH Server feature installed?" -ForegroundColor Yellow
    Write-Host "   PurveX will not accept an SSH runner without a pinned host key." -ForegroundColor Yellow
    exit 1
}

$RegistrationData = @{
    environment_name = $Env
    runner_type = "SSH"
    hostname = $Hostname
    port = $Port
    username = $Username
    os = (Get-CimInstance Win32_OperatingSystem).Caption
    ip_address = $LocalIP
    agent_version = "v1.0.0"
    status = "online"
    auth_method = "key"
    ssh_host_key_sha256 = $SshHostKeySha256
    allowed_test_types = '["Atomic only"]'
    max_concurrent_tests = 1
    heartbeat_interval_seconds = 5
    alert_offline_minutes = 5
    owner_name = $OwnerName
    owner_email = $OwnerEmail
} | ConvertTo-Json

Write-Host "Connecting to PurveX at: $ApiUrl" -ForegroundColor Cyan
Write-Host "Registering agent:" -ForegroundColor Cyan
Write-Host "  Hostname: $Hostname" -ForegroundColor White
Write-Host "  IP Address: $LocalIP" -ForegroundColor White
Write-Host "  Environment: $Env" -ForegroundColor White
Write-Host "  Owner: $OwnerName" -ForegroundColor White
Write-Host ""

$Url = "$($ApiUrl.TrimEnd('/'))/settings/environment-runners"
$Headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type" = "application/json"
}

try {
    $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $RegistrationData -ContentType "application/json" -ErrorAction Stop
    Write-Host "✅ Successfully registered with PurveX!" -ForegroundColor Green
    if ($Response.runner_token) {
        $Token = $Response.runner_token
        $Headers["Authorization"] = "Bearer $Token"
    }
    Write-Host "   Runner ID: $($Response.id)" -ForegroundColor White
    Write-Host "   Environment: $($Response.environment_name)" -ForegroundColor White
    Write-Host "   Hostname: $($Response.hostname)" -ForegroundColor White
    if ($Response.id) {
        $hbBody = @{
            os = (Get-CimInstance Win32_OperatingSystem).Caption
            ip_address = $LocalIP
            agent_version = "v1.0.0"
            status = "online"
        } | ConvertTo-Json
        $hbUrl = "$($ApiUrl.TrimEnd('/'))/agent/heartbeat"
        Invoke-RestMethod -Uri $hbUrl -Method Post -Headers $Headers -Body $hbBody -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
        $taskScript = Join-Path $env:ProgramData "PurveX\\purvex-heartbeat.ps1"
        New-Item -ItemType Directory -Path (Split-Path $taskScript) -Force | Out-Null
        @"
\$ApiUrl = "$ApiUrl"
\$Token = "$Token"
\$RunnerId = "$($Response.id)"
while (\$true) {
  \$os = (Get-CimInstance Win32_OperatingSystem).Caption
  \$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notlike "127.*" -and \$_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress
  \$body = @{ os = \$os; ip_address = \$ip; agent_version = "v1.0.0"; status = "online" } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "\$((\$ApiUrl.TrimEnd('/')))/agent/heartbeat" -Method Post -Headers @{ Authorization = "Bearer \$Token" } -Body \$body -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
  } catch {}
  try {
    \$cmd = Invoke-RestMethod -Uri "\$((\$ApiUrl.TrimEnd('/')))/agent/commands/next" -Method Get -Headers @{ Authorization = "Bearer \$Token" } -ErrorAction SilentlyContinue
    if (\$cmd -and \$cmd.command_type -eq "STOP_AGENT") {
      \$ackBody = @{ status = "completed"; message = "Agent stopped" } | ConvertTo-Json
      Invoke-RestMethod -Uri "\$((\$ApiUrl.TrimEnd('/')))/agent/commands/\$((\$cmd.id))/ack" -Method Post -Headers @{ Authorization = "Bearer \$Token" } -Body \$ackBody -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
      Unregister-ScheduledTask -TaskName "PurveX Agent Heartbeat" -Confirm:\$false -ErrorAction SilentlyContinue | Out-Null
      exit
    }
  } catch {}
  Start-Sleep -Seconds 5
}
"@ | Set-Content -Path $taskScript -Encoding UTF8
        $action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $taskScript + '"')
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
        Register-ScheduledTask -TaskName "PurveX Agent Heartbeat" -Action $action -Trigger $trigger -Force | Out-Null
    }
}
catch {
    $StatusCode = $_.Exception.Response.StatusCode.value__
    $ErrorBody = $_.ErrorDetails.Message
    if ($StatusCode -eq 404) {
        try {
            $Url = "$($ApiUrl.TrimEnd('/'))/api/settings/environment-runners"
            $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $RegistrationData -ContentType "application/json" -ErrorAction Stop
            Write-Host "✅ Successfully registered with PurveX!" -ForegroundColor Green
            if ($Response.runner_token) {
                $Token = $Response.runner_token
                $Headers["Authorization"] = "Bearer $Token"
            }
            Write-Host "   Runner ID: $($Response.id)" -ForegroundColor White
            Write-Host "   Environment: $($Response.environment_name)" -ForegroundColor White
            Write-Host "   Hostname: $($Response.hostname)" -ForegroundColor White
            if ($Response.id) {
                $hbBody = @{
                    os = (Get-CimInstance Win32_OperatingSystem).Caption
                    ip_address = $LocalIP
                    agent_version = "v1.0.0"
                    status = "online"
                } | ConvertTo-Json
                $hbUrl = "$($ApiUrl.TrimEnd('/'))/agent/heartbeat"
                Invoke-RestMethod -Uri $hbUrl -Method Post -Headers $Headers -Body $hbBody -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
                $taskScript = Join-Path $env:ProgramData "PurveX\\purvex-heartbeat.ps1"
                New-Item -ItemType Directory -Path (Split-Path $taskScript) -Force | Out-Null
                @"
\$ApiUrl = "$ApiUrl"
\$Token = "$Token"
\$RunnerId = "$($Response.id)"
while (\$true) {
  \$os = (Get-CimInstance Win32_OperatingSystem).Caption
  \$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notlike "127.*" -and \$_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress
  \$body = @{ os = \$os; ip_address = \$ip; agent_version = "v1.0.0"; status = "online" } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "\$((\$ApiUrl.TrimEnd('/')))/agent/heartbeat" -Method Post -Headers @{ Authorization = "Bearer \$Token" } -Body \$body -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
  } catch {}
  try {
    \$cmd = Invoke-RestMethod -Uri "\$((\$ApiUrl.TrimEnd('/')))/agent/commands/next" -Method Get -Headers @{ Authorization = "Bearer \$Token" } -ErrorAction SilentlyContinue
    if (\$cmd -and \$cmd.command_type -eq "STOP_AGENT") {
      \$ackBody = @{ status = "completed"; message = "Agent stopped" } | ConvertTo-Json
      Invoke-RestMethod -Uri "\$((\$ApiUrl.TrimEnd('/')))/agent/commands/\$((\$cmd.id))/ack" -Method Post -Headers @{ Authorization = "Bearer \$Token" } -Body \$ackBody -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
      Unregister-ScheduledTask -TaskName "PurveX Agent Heartbeat" -Confirm:\$false -ErrorAction SilentlyContinue | Out-Null
      exit
    }
  } catch {}
  Start-Sleep -Seconds 5
}
"@ | Set-Content -Path $taskScript -Encoding UTF8
                $action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $taskScript + '"')
                $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
                Register-ScheduledTask -TaskName "PurveX Agent Heartbeat" -Action $action -Trigger $trigger -Force | Out-Null
            }
            exit 0
        }
        catch {
            $StatusCode = $_.Exception.Response.StatusCode.value__
            $ErrorBody = $_.ErrorDetails.Message
        }
    }
    if ($StatusCode -eq 403) {
        Write-Host "❌ ERROR: Access denied. Check your API token and ensure you have admin privileges." -ForegroundColor Red
    }
    elseif ($StatusCode -eq 409) {
        Write-Host "⚠️  WARNING: A runner with this hostname already exists." -ForegroundColor Yellow
    }
    else {
        Write-Host "❌ ERROR: HTTP $StatusCode" -ForegroundColor Red
        if ($ErrorBody) {
            Write-Host "   Response: $ErrorBody" -ForegroundColor Yellow
        }
    }
    exit 1
}`;
  } else {
    return `#!/usr/bin/env python3
"""
PurveX Agent Registration Script
Copy and paste this onto any sandbox or lab computer.
"""

import base64
import hashlib
import os
import stat
import sys
import socket
import argparse
from pathlib import Path
from typing import Optional
from getpass import getpass

try:
    import requests
except ImportError:
    print("ERROR: 'requests' library not found. Install it with: pip install requests")
    sys.exit(1)

# Not secret — embedded so this script can provision its own authorized_keys
# entry. Specific to the registration token active when this was downloaded;
# re-download after regenerating the token if reusing this script.
PUBLIC_KEY = "${publicKey}"

def get_hostname() -> str:
    return socket.gethostname()

def provision_ssh_key(public_key: str) -> None:
    """Authorize PurveX's public key so the backend can SSH back in to run tests."""
    if os.name == "nt":
        target = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".ssh" / "authorized_keys"
    else:
        target = Path.home() / ".ssh" / "authorized_keys"
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = target.read_text(encoding="utf-8").splitlines() if target.exists() else []
    if public_key not in existing:
        with target.open("a", encoding="utf-8") as f:
            f.write(public_key + "\\n")
    if os.name != "nt":
        os.chmod(target.parent, stat.S_IRWXU)
        os.chmod(target, stat.S_IRUSR | stat.S_IWUSR)

def compute_host_key_sha256() -> Optional[str]:
    """Fingerprint this host's own SSH host key the same way PurveX does
    server-side: SHA256 over the raw key blob, base64-encoded, no padding."""
    if os.name == "nt":
        base = Path(os.environ.get("PROGRAMDATA", "C:\\\\ProgramData")) / "ssh"
    else:
        base = Path("/etc/ssh")
    for name in ("ssh_host_ed25519_key.pub", "ssh_host_ecdsa_key.pub", "ssh_host_rsa_key.pub"):
        path = base / name
        if not path.exists():
            continue
        try:
            parts = path.read_text(encoding="utf-8").strip().split()
            if len(parts) < 2:
                continue
            blob = base64.b64decode(parts[1])
            digest = base64.b64encode(hashlib.sha256(blob).digest()).decode("ascii").rstrip("=")
            return f"SHA256:{digest}"
        except (OSError, ValueError):
            continue
    return None

def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        try:
            s.connect(('10.254.254.254', 1))
            ip = s.getsockname()[0]
        except Exception:
            ip = '127.0.0.1'
        finally:
            s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def register_agent(api_url: str, api_token: str, environment: str, hostname: Optional[str] = None, port: int = 22, username: Optional[str] = None) -> dict:
    if not hostname:
        hostname = get_hostname()
    if not username:
        username = os.getenv('USER') or os.getenv('USERNAME') or 'purvex'
    owner_name = os.getenv('PURVEX_OWNER_NAME') or username
    owner_email = os.getenv('PURVEX_OWNER_EMAIL') or ""
    try:
        owner_name_input = input(f"Owner name [{owner_name}]: ").strip()
        if owner_name_input:
            owner_name = owner_name_input
        owner_email_input = input("Owner email (optional): ").strip()
        if owner_email_input:
            owner_email = owner_email_input
    except Exception:
        pass

    if PUBLIC_KEY:
        provision_ssh_key(PUBLIC_KEY)
    ssh_host_key_sha256 = compute_host_key_sha256()
    if not ssh_host_key_sha256:
        print("❌ ERROR: Could not determine this host's SSH host key fingerprint.")
        print("   Checked the local ssh_host_{ed25519,ecdsa,rsa}_key.pub files.")
        print("   PurveX will not accept an SSH runner without a pinned host key.")
        sys.exit(1)

    registration_data = {
        "environment_name": environment,
        "runner_type": "SSH",
        "hostname": hostname,
        "port": port,
        "username": username,
        "os": os.uname().sysname if hasattr(os, "uname") else "Unknown",
        "ip_address": get_local_ip(),
        "agent_version": "v1.0.0",
        "status": "online",
        "auth_method": "key",
        "ssh_host_key_sha256": ssh_host_key_sha256,
        "allowed_test_types": '["Atomic only"]',
        "max_concurrent_tests": 1,
        "heartbeat_interval_seconds": 5,
        "alert_offline_minutes": 5,
        "owner_name": owner_name,
        "owner_email": owner_email
    }

    url = f"{api_url.rstrip('/')}/settings/environment-runners"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }

    print("PurveX Agent Registration")
    print("-" * 40)
    print(f"API URL     : {api_url}")
    print("Agent Info  :")
    print(f"  Hostname  : {hostname}")
    print(f"  IP Address: {get_local_ip()}")
    print(f"  Environment: {environment}")
    print(f"  Owner     : {owner_name}")
    print()

    try:
        response = requests.post(url, json=registration_data, headers=headers, timeout=30)
        if response.status_code == 404:
            url = f"{api_url.rstrip('/')}/api/settings/environment-runners"
            response = requests.post(url, json=registration_data, headers=headers, timeout=30)
        response.raise_for_status()
        result = response.json()
        if result.get("runner_token"):
            api_token = result.get("runner_token")
            headers["Authorization"] = f"Bearer {api_token}"
        print("Status      : Registered")
        print(f"Runner ID   : {result.get('id')}")
        print(f"Environment : {result.get('environment_name')}")
        print(f"Hostname    : {result.get('hostname')}")
        if result.get("id"):
            hb_url = f"{api_url.rstrip('/')}/agent/heartbeat"
            hb_payload = {
                "os": os.uname().sysname if hasattr(os, "uname") else "Unknown",
                "ip_address": get_local_ip(),
                "agent_version": "v1.0.0",
                "status": "online",
            }
            try:
                requests.post(hb_url, json=hb_payload, headers=headers, timeout=10)
            except Exception:
                pass
            if os.name != "nt":
                service_path = "/usr/local/bin/purvex-agent-heartbeat.sh"
                unit_path = "/etc/systemd/system/purvex-agent-heartbeat.service"
                script = f"""#!/bin/bash
API_URL="{api_url}"
API_TOKEN="{api_token}"
RUNNER_ID="{result.get('id')}"
while true; do
  OS_NAME=$(uname -s 2>/dev/null || echo "Unknown")
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{{print $1}}' || echo "127.0.0.1")
  curl -s -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \\
    -d "{{\\"os\\":\\"$OS_NAME\\",\\"ip_address\\":\\"$LOCAL_IP\\",\\"agent_version\\":\\"v1.0.0\\",\\"status\\":\\"online\\"}}" \\
    "{api_url.rstrip('/')}/agent/heartbeat" >/dev/null 2>&1 || true
  CMD_JSON=$(curl -s -H "Authorization: Bearer \${{API_TOKEN}}" "\${{API_URL%/}}/agent/commands/next" || true)
  CMD_ID=$(echo "$CMD_JSON" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
  CMD_TYPE=$(echo "$CMD_JSON" | grep -o '"command_type":"[^"]*"' | cut -d'"' -f4)
  if [ "$CMD_TYPE" = "STOP_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${{API_TOKEN}}" -H "Content-Type: application/json" \\
      -d "{{\\"status\\":\\"completed\\",\\"message\\":\\"Agent stopped\\"}}" \\
      "\${{API_URL%/}}/agent/commands/\${{CMD_ID}}/ack" >/dev/null 2>&1 || true
    systemctl disable --now purvex-agent-heartbeat.service >/dev/null 2>&1 || true
    exit 0
  fi
  if [ "$CMD_TYPE" = "PAUSE_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${{API_TOKEN}}" -H "Content-Type: application/json" \\
      -d "{{\\"status\\":\\"completed\\",\\"message\\":\\"Agent paused\\"}}" \\
      "\${{API_URL%/}}/agent/commands/\${{CMD_ID}}/ack" >/dev/null 2>&1 || true
  fi
  if [ "$CMD_TYPE" = "RESUME_AGENT" ] && [ -n "$CMD_ID" ]; then
    curl -s -X POST -H "Authorization: Bearer \${{API_TOKEN}}" -H "Content-Type: application/json" \\
      -d "{{\\"status\\":\\"completed\\",\\"message\\":\\"Agent resumed\\"}}" \\
      "\${{API_URL%/}}/agent/commands/\${{CMD_ID}}/ack" >/dev/null 2>&1 || true
  fi
  sleep 5
done
"""
                unit = f"""[Unit]
Description=PurveX Agent Heartbeat
After=network-online.target

[Service]
Type=simple
ExecStart={service_path}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
"""
                try:
                    with open("/tmp/purvex-agent-heartbeat.sh", "w", encoding="utf-8") as f:
                        f.write(script)
                    with open("/tmp/purvex-agent-heartbeat.service", "w", encoding="utf-8") as f:
                        f.write(unit)
                    os.system(f"sudo mv /tmp/purvex-agent-heartbeat.sh {service_path}")
                    os.system(f"sudo mv /tmp/purvex-agent-heartbeat.service {unit_path}")
                    os.system(f"sudo chmod +x {service_path}")
                    os.system("sudo systemctl daemon-reload")
                    os.system("sudo systemctl enable --now purvex-agent-heartbeat.service")
                except Exception:
                    pass
        return result
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 403:
            print("❌ ERROR: Access denied. Check your API token and ensure you have admin privileges.")
        elif e.response.status_code == 409:
            print("⚠️  WARNING: A runner with this hostname already exists.")
        else:
            print(f"❌ ERROR: HTTP {e.response.status_code}")
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print(f"❌ ERROR: Cannot connect to {api_url}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR: {type(e).__name__}: {str(e)}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Register this machine as a PurveX test runner agent")
    parser.add_argument('--api-url', default=os.getenv('PURVEX_API_URL', '${apiUrl}'), help='PurveX API base URL')
    token_placeholder = "__PURVEX_TOKEN_PLACEHOLDER__"
    parser.add_argument('--token', default=os.getenv('PURVEX_API_TOKEN', "__PURVEX_TOKEN_PLACEHOLDER__"), help='Registration token (required)')
    parser.add_argument('--env', default=os.getenv('PURVEX_ENV', 'lab'), help='Environment name: lab, dev, or prod')
    parser.add_argument('--hostname', default=None, help='Custom hostname (auto-detected if not provided)')
    parser.add_argument('--port', type=int, default=22, help='SSH port (default: 22)')
    parser.add_argument('--username', default=None, help='SSH username (defaults to current user)')

    args = parser.parse_args()

    api_token = args.token
    env_set = '--env' in sys.argv or os.getenv('PURVEX_ENV') is not None
    if not env_set:
        input_env = input(f"Environment [lab/dev/prod] ({args.env}): ").strip()
        if input_env:
            args.env = input_env

    if not api_token or api_token == token_placeholder:
        input_api = input(f"PurveX API URL [{args.api_url}]: ").strip()
        if input_api:
            args.api_url = input_api
        api_token = getpass("Registration token: ")

    if not api_token or api_token == token_placeholder:
        print("❌ ERROR: Registration token is required.")
        print("   Provide it via --token or set PURVEX_API_TOKEN.")
        sys.exit(1)

    register_agent(api_url=args.api_url, api_token=api_token, environment=args.env, hostname=args.hostname, port=args.port, username=args.username)

if __name__ == '__main__':
    main()`;
  }
}

interface RegisterAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered?: () => void;
}

/**
 * Register a new validation agent — either the guided installer-script flow
 * (generate a token, download a script, run it on the target machine) or a
 * manual SSH runner entry. Used to live as its own settings page
 * (/settings/test-runner); consolidated here since Endpoints is where
 * agents are actually managed day to day, and registration only ever
 * happens from this page's "Add agent" action.
 */
export function RegisterAgentDialog({ open, onOpenChange, onRegistered }: RegisterAgentDialogProps) {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canManageAgents = hasPermission(Permission.SETTINGS_RUNNERS_MANAGE);

  const [publicApiUrl, setPublicApiUrl] = useState<string>(getDefaultRunnerApiUrl());
  const [selectedScript, setSelectedScript] = useState<"bash" | "powershell" | "python">("bash");
  const [userToken, setUserToken] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [tokenExpiresInMinutes, setTokenExpiresInMinutes] = useState<number | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  const [formData, setFormData] = useState<Partial<EnvironmentRunnerConfig>>({
    environment_name: "",
    runner_type: "SSH",
    port: 22,
    auth_method: "key",
    allowed_test_types: '["Atomic only"]',
    max_concurrent_tests: 1,
    heartbeat_interval_seconds: 5,
    alert_offline_minutes: 5,
    owner_name: "",
    owner_email: "",
    ssh_host_key_sha256: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [sshError, setSshError] = useState<string | null>(null);
  const [sshErrorIsUpgrade, setSshErrorIsUpgrade] = useState(false);

  async function handleGenerateToken() {
    try {
      setTokenLoading(true);
      const response = (await apiFetch("/settings/agent-registration-token", {
        method: "POST",
      })) as AgentRegistrationResponse;
      if (response?.token) {
        setUserToken(response.token);
        setPublicKey(response.public_key ?? null);
        setShowToken(false);
        setTokenCopied(false);
        setTokenExpiresInMinutes(response?.expires_in_minutes ?? null);
        toast({ type: "success", title: "Token generated", description: "Use this token once during agent registration." });
      } else {
        throw new Error("Token was not returned by the API.");
      }
    } catch (err: unknown) {
      toast({ type: "error", title: "Token generation failed", description: getErrorMessage(err, "Unable to generate a registration token.") });
    } finally {
      setTokenLoading(false);
    }
  }

  function handleDownloadScript() {
    if (!publicKey) {
      toast({ type: "error", title: "Generate a token first", description: "The script provisions PurveX's public key, minted alongside a registration token — generate one before downloading." });
      return;
    }
    try {
      const apiUrl = publicApiUrl.trim() || getDefaultRunnerApiUrl();
      const script = getAgentScript(selectedScript, apiUrl, publicKey);
      const blob = new Blob([script], { type: "text/plain" });
      const filename = selectedScript === "bash" ? "register_agent.sh" : selectedScript === "powershell" ? "register_agent.ps1" : "register_agent.py";
      if (typeof window !== "undefined" && (window.navigator as NavigatorWithMsSave).msSaveOrOpenBlob) {
        (window.navigator as NavigatorWithMsSave).msSaveOrOpenBlob?.(blob, filename);
      } else if (typeof window !== "undefined") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        requestAnimationFrame(() => {
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        });
      }
      toast({
        type: "success",
        title: "Script downloaded",
        description: selectedScript === "bash" ? `${filename} downloaded. Run: chmod +x ${filename}` : `${filename} downloaded. Provide token when running it.`,
      });
    } catch (err: unknown) {
      toast({ type: "error", title: "Download failed", description: getErrorMessage(err, "Unable to download script. Please try again.") });
    }
  }

  function handleCopyCommand() {
    const apiUrl = publicApiUrl.trim() || getDefaultRunnerApiUrl();
    let command = "";
    if (selectedScript === "bash") {
      command = `chmod +x register_agent.sh\nPURVEX_API_TOKEN=YOUR_TOKEN_HERE ./register_agent.sh --api-url ${apiUrl} --env lab`;
    } else if (selectedScript === "powershell") {
      command = `$env:PURVEX_API_TOKEN="YOUR_TOKEN_HERE"; .\\register_agent.ps1 -ApiUrl "${apiUrl}" -Env "lab"`;
    } else {
      command = `python3 register_agent.py --api-url ${apiUrl} --token YOUR_TOKEN_HERE --env lab`;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(command).then(() => {
        setCommandCopied(true);
        setTimeout(() => setCommandCopied(false), 2000);
      }).catch(() => {});
    }
  }

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  }

  function handleSelectChange(id: keyof EnvironmentRunnerConfig, value: string) {
    setFormData((prev) => ({ ...prev, [id]: value }));
  }

  async function handleSshSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.environment_name || !formData.runner_type || !formData.auth_method) {
      setSshError("Please fill in all required fields.");
      return;
    }
    if ((formData.runner_type || "").toUpperCase() === "SSH" && !formData.ssh_host_key_sha256?.trim()) {
      setSshError("SSH host key SHA256 fingerprint is required before this runner can execute validations.");
      return;
    }
    setIsSaving(true);
    setSshError(null);
    setSshErrorIsUpgrade(false);
    try {
      await apiFetch("/settings/environment-runners", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      toast({ type: "success", title: "Runner registered", description: `${formData.environment_name} is now available for validations.` });
      setFormData({
        environment_name: "",
        runner_type: "SSH",
        port: 22,
        auth_method: "key",
        allowed_test_types: '["Atomic only"]',
        max_concurrent_tests: 1,
        heartbeat_interval_seconds: 5,
        alert_offline_minutes: 5,
        owner_name: "",
        owner_email: "",
        ssh_host_key_sha256: "",
      });
      onOpenChange(false);
      onRegistered?.();
    } catch (err: unknown) {
      setSshError(getErrorMessage(err, "Failed to save environment runner configuration."));
      setSshErrorIsUpgrade(isUpgradeRequiredError(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(calc(100vw-2rem),42rem)] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Register agent
          </DialogTitle>
          <DialogDescription>
            Agents run validations in an environment and report evidence back to PurveX.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="agent" className="mt-2">
          <TabsList>
            <TabsTrigger value="agent">Installer script</TabsTrigger>
            <TabsTrigger value="ssh">Manual SSH</TabsTrigger>
          </TabsList>

          <TabsContent value="agent" className="space-y-5 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="public_api_url">API endpoint</Label>
              <Input
                id="public_api_url"
                value={publicApiUrl}
                onChange={(e) => setPublicApiUrl(e.target.value)}
                placeholder="https://purvex.company.com/api"
              />
              <p className="text-xs text-muted-foreground">
                The address the agent will call. Override for a tunnel, reverse proxy, VPN hostname, or public domain.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Platform</Label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { key: "bash", label: "Linux/Unix", icon: Terminal },
                    { key: "powershell", label: "Windows", icon: Monitor },
                    { key: "python", label: "Python", icon: Code },
                  ] as const
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedScript(key)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition",
                      selectedScript === key
                        ? "border-primary bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "border-[var(--stroke-soft)] text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Registration token</p>
                  <code className="block truncate text-sm font-mono text-foreground">
                    {tokenLoading && !userToken && "Generating…"}
                    {!tokenLoading && !userToken && "No active token"}
                    {userToken && (showToken ? userToken : `${userToken.slice(0, 6)}…${userToken.slice(-4)}`)}
                  </code>
                  {tokenExpiresInMinutes && (
                    <p className="text-[11px] text-muted-foreground">Single-use. Expires in {tokenExpiresInMinutes} minutes.</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="sm" onClick={handleGenerateToken} disabled={tokenLoading || !canManageAgents}>
                    {tokenLoading ? "Generating…" : userToken ? "Regenerate" : "Generate"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowToken((v) => !v)} disabled={!userToken}>
                    {showToken ? "Hide" : "Reveal"}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={!userToken}
                    onClick={() => {
                      if (!userToken || typeof navigator === "undefined" || !navigator.clipboard) return;
                      navigator.clipboard.writeText(userToken).then(() => {
                        setTokenCopied(true);
                        setTimeout(() => setTokenCopied(false), 2000);
                      }).catch(() => {});
                    }}
                  >
                    {tokenCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CopyIcon className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleDownloadScript} disabled={!canManageAgents || !publicKey} title={!publicKey ? "Generate a registration token first" : ""}>
                <Download className="h-4 w-4" />
                Download {selectedScript === "bash" ? "register_agent.sh" : selectedScript === "powershell" ? "register_agent.ps1" : "register_agent.py"}
              </Button>
              <Button type="button" variant="outline" onClick={handleCopyCommand}>
                {commandCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CopyIcon className="h-4 w-4" />}
                {commandCopied ? "Copied" : "Copy run command"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Run it on the target machine and paste the token when prompted (or pass it via env var / flag).
              {selectedScript === "bash" && " After download: chmod +x register_agent.sh."}
            </p>
          </TabsContent>

          <TabsContent value="ssh" className="pt-4">
            <form onSubmit={handleSshSubmit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="environment_name">Environment name</Label>
                  <Input id="environment_name" value={formData.environment_name || ""} onChange={handleFormChange} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hostname">Hostname / IP</Label>
                  <Input id="hostname" value={formData.hostname || ""} onChange={handleFormChange} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="port">Port</Label>
                  <Input id="port" type="number" value={formData.port || 22} onChange={handleFormChange} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" value={formData.username || ""} onChange={handleFormChange} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auth_method">Authentication method</Label>
                  <Select onValueChange={(value: string) => handleSelectChange("auth_method", value)} value={formData.auth_method}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select auth method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="key">Key (path or stored secret)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="key_path">Key path</Label>
                  <Input id="key_path" value={formData.key_path || ""} onChange={handleFormChange} placeholder="/path/to/private_key.pem" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ssh_host_key_sha256">SSH host key SHA256 fingerprint</Label>
                  <Input
                    id="ssh_host_key_sha256"
                    value={formData.ssh_host_key_sha256 || ""}
                    onChange={handleFormChange}
                    placeholder="SHA256:AbCdEf..."
                  />
                  <p className="text-[11px] text-muted-foreground">Capture from a trusted path with ssh-keyscan and ssh-keygen before saving.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="owner_name">Owner name</Label>
                  <Input id="owner_name" value={formData.owner_name || ""} onChange={handleFormChange} placeholder="Jane Smith" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="owner_email">Owner email</Label>
                  <Input id="owner_email" value={formData.owner_email || ""} onChange={handleFormChange} placeholder="jane@company.com" />
                </div>
              </div>

              {sshError && sshErrorIsUpgrade ? (
                <UpgradeBanner message={sshError} />
              ) : sshError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  {sshError}
                </div>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving || !canManageAgents} title={!canManageAgents ? "Administrator access required" : ""}>
                  {isSaving ? "Saving…" : "Save runner"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
