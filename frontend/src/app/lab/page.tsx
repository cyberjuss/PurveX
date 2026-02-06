"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, ServerCog, Copy as CopyIcon, CheckCircle2, AlertTriangle, Clock, Activity, Zap, Play, Terminal, Monitor, Code, Download, CheckCircle, ArrowRight, FileText, Rocket, ChevronDown, ChevronRight, HardDrive, Network, Tag, Eye, FileText as LogsIcon, Settings, AlertCircle, Info } from "lucide-react";
import { apiFetch, getTest, type TestDetailResponse } from "@/lib/api";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Helper function to get API URL
function getApiUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${process.env.NEXT_PUBLIC_API_PORT || "8001"}`;
  }
  return "http://127.0.0.1:8001";
}

// Helper function to get agent script content
function getAgentScript(type: "bash" | "powershell" | "python", apiUrl: string): string {
  if (type === "bash") {
    return `#!/bin/bash
# PurveX Agent Registration Script (Bash version)
# Copy and paste this onto any Linux/Unix sandbox or lab computer.

set -e

API_URL="${apiUrl}"
TOKEN_PLACEHOLDER="__PURVEX_TOKEN_PLACEHOLDER__"
API_TOKEN="${"${PURVEX_API_TOKEN:-__PURVEX_TOKEN_VALUE__}"}"
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
    [string]$Token = "__PURVEX_TOKEN_VALUE__",
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

import os
import sys
import socket
import argparse
from typing import Optional
from getpass import getpass

try:
    import requests
except ImportError:
    print("ERROR: 'requests' library not found. Install it with: pip install requests")
    sys.exit(1)

def get_hostname() -> str:
    return socket.gethostname()

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
    parser.add_argument('--token', default=os.getenv('PURVEX_API_TOKEN', "__PURVEX_TOKEN_VALUE__"), help='Registration token (required)')
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

function LabPageContent() {
  const [currentTest, setCurrentTest] = useState<TestDetailResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [selectedScript, setSelectedScript] = useState<"bash" | "powershell" | "python">("bash");
  const [copied, setCopied] = useState(false);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [tokenExpiresInMinutes, setTokenExpiresInMinutes] = useState<number | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(false);
  const [deleteEndpoint, setDeleteEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [pauseEndpoint, setPauseEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [resumeEndpoint, setResumeEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const searchParams = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const testIdParam = searchParams.get("testId");
    if (!testIdParam) return;

    let cancelled = false;

    async function pollTest() {
      try {
        setTestError(null);
        const id = Number(testIdParam);
        if (Number.isNaN(id)) return;

        let attempts = 0;
        while (!cancelled && attempts < 60) {
          const test = await getTest(id);
          if (!test) {
            // Test not found - stop polling
            break;
          }
          setCurrentTest(test);
          if (test.status !== "pending" && test.status !== "running") {
            break;
          }
          attempts += 1;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (err: any) {
        if (!cancelled) {
          setTestError(err?.message || "Failed to load lab run.");
        }
      }
    }

    pollTest();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  // Auto-generate registration token for seamless registration (like Microsoft Arc)
  useEffect(() => {
    async function generateRegistrationToken() {
      try {
        setTokenLoading(true);
        // Generate a new registration token specifically for agent registration
        const response = await apiFetch("/settings/agent-registration-token", {
          method: "POST",
        });
        if (response?.token) {
          setUserToken(response.token);
          if (response?.expires_in_minutes) {
            setTokenExpiresInMinutes(response.expires_in_minutes);
          }
        }
      } catch (err: any) {
        // If token generation fails, rely on server-side session state.
      } finally {
        setTokenLoading(false);
      }
    }
    generateRegistrationToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteEndpoint = async (endpointId: number) => {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}`, {
        method: "DELETE",
      });
      setEndpoints((prev) => prev.filter((endpoint) => endpoint.id !== endpointId));
    } catch (err) {
      console.error("Failed to delete endpoint:", err);
    }
  };

  const handlePauseEndpoint = async (endpointId: number) => {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}/pause`, { method: "POST" });
      setEndpoints((prev) =>
        prev.map((endpoint) =>
          endpoint.id === endpointId ? { ...endpoint, status: "pausing" } : endpoint
        )
      );
      toast({
        type: "success",
        title: "Pause requested",
        description: "Agent pause command queued.",
      });
    } catch (err: any) {
      toast({
        type: "error",
        title: "Failed to pause agent",
        description: err?.message || "Unable to send pause command.",
      });
    }
  };

  const handleResumeEndpoint = async (endpointId: number) => {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}/resume`, { method: "POST" });
      setEndpoints((prev) =>
        prev.map((endpoint) =>
          endpoint.id === endpointId ? { ...endpoint, status: "resuming" } : endpoint
        )
      );
      toast({
        type: "success",
        title: "Resume requested",
        description: "Agent resume command queued.",
      });
    } catch (err: any) {
      toast({
        type: "error",
        title: "Failed to resume agent",
        description: err?.message || "Unable to send resume command.",
      });
    }
  };

  // Fetch environment runners/endpoints
  useEffect(() => {
    async function fetchEndpoints() {
      try {
        setEndpointsLoading(true);
        const runners = await apiFetch("/settings/environment-runners", {
          cache: "no-store",
        });
        const tests = await apiFetch("/tests/?limit=100", { cache: "no-store" }).catch(() => []);
        const latestByEndpoint = new Map<string, any>();
        const testsByEndpoint = new Map<string, any[]>();
        const testsByEnvironment = new Map<string, any[]>();
        if (Array.isArray(tests)) {
          tests.forEach((test: any) => {
            if (!test.endpoint) return;
            const existing = latestByEndpoint.get(test.endpoint);
            if (!existing || new Date(test.started_at).getTime() > new Date(existing.started_at).getTime()) {
              latestByEndpoint.set(test.endpoint, test);
            }
          });
          tests.forEach((test: any) => {
            if (test.endpoint) {
              const existing = testsByEndpoint.get(test.endpoint) || [];
              existing.push(test);
              testsByEndpoint.set(test.endpoint, existing);
            }
            if (test.environment) {
              const existingEnv = testsByEnvironment.get(test.environment) || [];
              existingEnv.push(test);
              testsByEnvironment.set(test.environment, existingEnv);
            }
          });
        }
        // Transform runners to endpoint format using only real data
        if (runners && Array.isArray(runners) && runners.length > 0) {
          const transformedEndpoints = runners.map((runner: any) => ({
            id: runner.id,
            hostname: runner.hostname || `endpoint-${runner.id}`,
            os: runner.os || "—",
            ipAddress: runner.ip_address || "—",
            status: runner.status || (runner.last_check_in ? "online" : "unknown"),
            lastCheckIn: runner.last_check_in ? new Date(runner.last_check_in).toLocaleString() : "—",
            lastTestRun: (() => {
              const latest = latestByEndpoint.get(runner.hostname);
              if (!latest) return "—";
              return latest.technique_id || "—";
            })(),
            recentTests: (() => {
              const endpointKey = runner.hostname;
              const envKey = runner.environment_name;
              const source = (endpointKey && testsByEndpoint.get(endpointKey)) || (envKey && testsByEnvironment.get(envKey)) || [];
              return source
                .slice()
                .sort((a: any, b: any) => new Date(b.started_at || b.created_at || b.finished_at || 0).getTime() - new Date(a.started_at || a.created_at || a.finished_at || 0).getTime())
                .slice(0, 3);
            })(),
            agentVersion: runner.agent_version || "—",
            tags: [],
            environment: runner.environment_name || "lab",
            runnerType: runner.runner_type,
            port: runner.port,
            username: runner.username,
          }));
          setEndpoints(transformedEndpoints);
        } else {
          setEndpoints([]);
        }
      } catch (err) {
        console.error("Failed to fetch endpoints:", err);
        setEndpoints([]);
      } finally {
        setEndpointsLoading(false);
      }
    }
    fetchEndpoints();
  }, []);

  const labStatus = (currentTest?.status || "pending").toLowerCase();
  let labProgress = 0.2;
  if (labStatus === "running") {
    labProgress = 0.6;
  } else if (labStatus !== "pending") {
    labProgress = 1;
  }

  return (
    <PageContainer maxWidth="full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
          <div className="w-full pl-0.5 pr-0 sm:pr-0">
            <PageHeader
              eyebrow="Controlled lab"
              title="Lab"
              subtitle="Experiment safely and validate detection changes"
              icon={<FlaskConical className="h-5 w-5" />}
            />
          </div>


          {/* Agent Registration Scripts - Moved to Test Runner Settings */}

          {/* Endpoints / Agents Table */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                    <HardDrive className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-display font-semibold text-slate-900">
                      Endpoints
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-600 mt-1">
                      {endpoints.length} {endpoints.length === 1 ? "endpoint" : "endpoints"} connected
                    </CardDescription>
                  </div>
                </div>
                <Link href="/settings/test-runner">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-10 px-5 rounded-full bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm text-xs font-semibold tracking-wide"
                  >
                    <ServerCog className="h-4 w-4 mr-2" />
                    Install Agent
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-6 pb-6 px-6">
              {endpointsLoading && endpoints.length === 0 ? (
                <LoadingState message="Loading endpoints..." size="sm" className="py-6" />
              ) : endpoints.length === 0 ? (
                <div className="text-center py-10">
                  <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-slate-100 border border-slate-200 mb-3">
                    <HardDrive className="h-6 w-6 text-slate-600" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mb-1">No endpoints registered</p>
                  <p className="text-xs text-slate-600">Use Install Agent to connect your first endpoint.</p>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="text-left py-3 px-3 w-8"></th>
                        <th className="text-left py-3 px-3 min-w-[140px] font-semibold uppercase tracking-wider">Hostname</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">OS</th>
                        <th className="text-left py-3 px-3 min-w-[120px] font-semibold uppercase tracking-wider">IP</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">Check-in</th>
                        <th className="text-left py-3 px-3 min-w-[150px] font-semibold uppercase tracking-wider">Last Test</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">Version</th>
                        <th className="text-left py-3 px-3 min-w-[120px] font-semibold uppercase tracking-wider">Tags</th>
                        <th className="text-right py-3 px-3 min-w-[120px] font-semibold uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                      {endpoints.map((endpoint) => (
                        <React.Fragment key={`endpoint-${endpoint.id}`}>
                          <tr
                            className="hover:bg-slate-50 transition-colors cursor-pointer group focus-within:bg-slate-50"
                            onClick={() => {
                              const newExpanded = new Set(expandedRows);
                              if (newExpanded.has(endpoint.id)) {
                                newExpanded.delete(endpoint.id);
                              } else {
                                newExpanded.add(endpoint.id);
                              }
                              setExpandedRows(newExpanded);
                            }}
                            role="button"
                            tabIndex={0}
                            aria-expanded={expandedRows.has(endpoint.id)}
                            aria-label={`${expandedRows.has(endpoint.id) ? "Collapse" : "Expand"} details for ${endpoint.hostname}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                const newExpanded = new Set(expandedRows);
                                if (newExpanded.has(endpoint.id)) {
                                  newExpanded.delete(endpoint.id);
                                } else {
                                  newExpanded.add(endpoint.id);
                                }
                                setExpandedRows(newExpanded);
                              }
                            }}
                          >
                            <td className="py-3 px-3">
                              {expandedRows.has(endpoint.id) ? (
                                <ChevronDown className="h-4 w-4 text-slate-500" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-slate-500" />
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-4 w-4 text-slate-500 flex-shrink-0" />
                                <span className="font-medium text-slate-900 truncate">{endpoint.hostname}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                {endpoint.os.includes("Windows") ? (
                                  <Monitor className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                ) : (
                                  <Terminal className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                                )}
                                <span className="text-slate-900 truncate">{endpoint.os}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <code className="text-xs font-mono text-slate-900">{endpoint.ipAddress}</code>
                            </td>
                            <td className="py-3 px-3">
                              <Badge
                                className={cn(
                                  endpoint.status === "online" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                                  endpoint.status === "degraded" && "bg-amber-50 text-amber-700 border-amber-200",
                                  endpoint.status === "idle" && "bg-blue-50 text-blue-700 border-blue-200",
                                  endpoint.status === "stopping" && "bg-amber-50 text-amber-700 border-amber-200",
                                  endpoint.status === "stopped" && "bg-slate-100 text-slate-700 border-slate-200",
                                  endpoint.status === "paused" && "bg-slate-100 text-slate-700 border-slate-200",
                                  endpoint.status === "pausing" && "bg-amber-50 text-amber-700 border-amber-200",
                                  endpoint.status === "resuming" && "bg-blue-50 text-blue-700 border-blue-200",
                                  endpoint.status === "unknown" && "bg-slate-100 text-slate-600 border-slate-200",
                                  "inline-flex items-center gap-2 border text-xs px-2.5 py-1 rounded-full"
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    endpoint.status === "online" && "bg-emerald-500",
                                    endpoint.status === "degraded" && "bg-amber-500",
                                    endpoint.status === "idle" && "bg-blue-500",
                                    endpoint.status === "stopping" && "bg-amber-500",
                                    endpoint.status === "stopped" && "bg-slate-500",
                                    endpoint.status === "paused" && "bg-slate-500",
                                    endpoint.status === "pausing" && "bg-amber-500",
                                    endpoint.status === "resuming" && "bg-blue-500",
                                    endpoint.status === "unknown" && "bg-slate-400",
                                    endpoint.status !== "online" &&
                                      endpoint.status !== "degraded" &&
                                      endpoint.status !== "idle" &&
                                      endpoint.status !== "stopping" &&
                                      endpoint.status !== "stopped" &&
                                      endpoint.status !== "paused" &&
                                      endpoint.status !== "pausing" &&
                                      endpoint.status !== "resuming" &&
                                      "bg-slate-400"
                                  )}
                                />
                                <span className="font-semibold capitalize">{endpoint.status === "unknown" ? "Unknown" : endpoint.status}</span>
                              </Badge>
                            </td>
                            <td className="py-3 px-3">
                              <span className="text-slate-900">{endpoint.lastCheckIn || "—"}</span>
                            </td>
                            <td className="py-3 px-3">
                              <span className="text-slate-900 truncate block">{endpoint.lastTestRun || "—"}</span>
                            </td>
                            <td className="py-3 px-3">
                              <Badge className="bg-slate-100 text-slate-800 border border-slate-200 text-xs px-2.5 py-1 rounded-full font-semibold">
                                {endpoint.agentVersion || "—"}
                              </Badge>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                {endpoint.tags.slice(0, 2).map((tag: string, idx: number) => (
                                  <Badge
                                    key={idx}
                                    className="bg-sky-50 text-sky-700 border border-sky-200 text-xs px-2.5 py-1 rounded-full font-semibold"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                                {endpoint.tags.length > 2 && (
                                  <span className="text-xs text-slate-500 font-semibold">+{endpoint.tags.length - 2}</span>
                                )}
                                {endpoint.tags.length === 0 && (
                                  <span className="text-xs text-slate-500 font-semibold">—</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {endpoint.status === "paused" || endpoint.status === "pausing" || endpoint.status === "stopped" ? (
                                  <button
                                    type="button"
                                    aria-label={`Resume ${endpoint.hostname}`}
                                    title={endpoint.status === "stopped" ? "Start agent" : "Resume agent"}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setResumeEndpoint({ id: endpoint.id, name: endpoint.hostname });
                                    }}
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors"
                                  >
                                    ▶
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    aria-label={`Pause ${endpoint.hostname}`}
                                    title="Pause agent"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPauseEndpoint({ id: endpoint.id, name: endpoint.hostname });
                                    }}
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 hover:bg-slate-100 transition-colors"
                                  >
                                    ❚❚
                                  </button>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Remove ${endpoint.hostname}`}
                                  title="Remove endpoint"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteEndpoint({ id: endpoint.id, name: endpoint.hostname });
                                }}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                              >
                                ×
                              </button>
                              </div>
                            </td>
                          </tr>
                          {expandedRows.has(endpoint.id) && (
                            <tr className="bg-slate-50 animate-in fade-in slide-in-from-top-2 duration-300">
                              <td colSpan={10} className="py-4 px-4">
                                <div className="grid md:grid-cols-2 gap-5">
                                  {/* Telemetry Health */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <Activity className="h-4 w-4 text-emerald-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Telemetry Health</h4>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">SIEM Connectivity</span>
                                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                          —
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Event Collection</span>
                                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                          —
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Last Event</span>
                                        <span className="text-xs text-slate-900 font-mono">—</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Detection Visibility */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <Eye className="h-4 w-4 text-sky-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Detection Visibility</h4>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Detections Active</span>
                                        <span className="text-xs text-slate-900 font-semibold">—</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Last Detection</span>
                                        <span className="text-xs text-slate-900 font-mono">—</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Coverage Score</span>
                                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                          —
                                        </Badge>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Test Run Logs */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <LogsIcon className="h-4 w-4 text-blue-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Recent Test Runs</h4>
                                    </div>
                                    <div className="space-y-2">
                                      {(endpoint.recentTests || []).length === 0 ? (
                                        <div className="p-2 rounded bg-slate-50 border border-slate-200">
                                          <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-medium text-slate-900 truncate">No recent test data</span>
                                            <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                              —
                                            </Badge>
                                          </div>
                                          <p className="text-[10px] text-slate-600">—</p>
                                        </div>
                                      ) : (
                                        (endpoint.recentTests || []).map((test: any) => (
                                          <div key={test.id} className="p-2 rounded bg-slate-50 border border-slate-200">
                                            <div className="flex items-center justify-between mb-1.5">
                                              <span className="text-xs font-medium text-slate-900 truncate">
                                                {test.detection_title || test.technique_id || `Test #${test.id}`}
                                              </span>
                                              <Badge className={cn(
                                                "text-xs px-2 py-1 h-5 border",
                                                test.status === "PASS" && "bg-emerald-100 text-emerald-700 border-emerald-200",
                                                test.status === "FAIL" && "bg-red-100 text-red-700 border-red-200",
                                                test.status === "INCONCLUSIVE" && "bg-amber-100 text-amber-700 border-amber-200",
                                                !test.status && "bg-slate-100 text-slate-600 border-slate-200"
                                              )}>
                                                {test.status || "—"}
                                              </Badge>
                                            </div>
                                            <p className="text-[10px] text-slate-600">
                                              {test.started_at ? new Date(test.started_at).toLocaleString() : "—"}
                                            </p>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>

                                  {/* Configuration & Drift */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <Settings className="h-4 w-4 text-purple-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Configuration</h4>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Environment</span>
                                        <Badge className="bg-purple-100 text-purple-700 border-purple-300 text-xs px-2 py-1 h-5">
                                          {endpoint.environment || "—"}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Runner Type</span>
                                        <span className="text-xs text-slate-900 font-mono">{endpoint.runnerType || "—"}</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Drift Status</span>
                                        <span className="text-xs text-slate-600">—</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Register Agent Dialog */}
          <Dialog open={showRegisterDialog} onOpenChange={setShowRegisterDialog}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle className="text-xl font-display font-bold text-slate-900">
                  Register Agent
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-600 mt-2">
                  Download a registration script to register a new agent in your lab environment. The script is pre-configured with a single-use token{tokenExpiresInMinutes ? ` (expires in ${tokenExpiresInMinutes} minutes)` : ""}.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <div className="space-y-3">
                  <label className="text-sm font-semibold text-slate-900">Select Script Type</label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => setSelectedScript("bash")}
                      className={cn(
                        "p-4 rounded-lg border-2 transition-all duration-200",
                        selectedScript === "bash"
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      <Terminal className="h-6 w-6 mx-auto mb-2 text-slate-700" />
                      <p className="text-sm font-medium text-slate-900">Bash</p>
                      <p className="text-xs text-slate-600 mt-1">Linux/Unix</p>
                    </button>
                    <button
                      onClick={() => setSelectedScript("powershell")}
                      className={cn(
                        "p-4 rounded-lg border-2 transition-all duration-200",
                        selectedScript === "powershell"
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      <Monitor className="h-6 w-6 mx-auto mb-2 text-slate-700" />
                      <p className="text-sm font-medium text-slate-900">PowerShell</p>
                      <p className="text-xs text-slate-600 mt-1">Windows</p>
                    </button>
                    <button
                      onClick={() => setSelectedScript("python")}
                      className={cn(
                        "p-4 rounded-lg border-2 transition-all duration-200",
                        selectedScript === "python"
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      <Code className="h-6 w-6 mx-auto mb-2 text-slate-700" />
                      <p className="text-sm font-medium text-slate-900">Python</p>
                      <p className="text-xs text-slate-600 mt-1">Cross-platform</p>
                    </button>
                  </div>
                </div>
                {selectedScript === "bash" && (
                  <p className="text-xs text-slate-500">
                    Note: browsers can’t set execute permissions. After download, run{" "}
                    <span className="font-mono">chmod +x register_agent.sh</span>.
                  </p>
                )}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowRegisterDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (!userToken && tokenLoading) {
                        toast({
                          type: "warning",
                          title: "Token still generating",
                          description: "Please wait for the registration token to be generated.",
                        });
                        return;
                      }
                      if (!userToken) {
                        toast({
                          type: "error",
                          title: "Token not available",
                          description: "Unable to download script without a registration token. Please refresh the page.",
                          action: {
                            label: "Retry",
                            onClick: () => window.location.reload(),
                          },
                        });
                        return;
                      }
                      try {
                        const apiUrl = getApiUrl();
                        let script = getAgentScript(selectedScript, apiUrl);

                        // Auto-inject generated token and update prompt labels
                        script = script.replace(/__PURVEX_TOKEN_VALUE__/g, userToken);
                        if (selectedScript === "bash") {
                          script = script.replace(/YOUR_TOKEN_HERE/g, userToken);
                          script = script.replace(/API_TOKEN="YOUR_TOKEN_HERE"/g, `API_TOKEN="${userToken}"`);
                          script = script.replace(/read -r -s -p "Registration token \\(paste and press Enter\\): " API_TOKEN\\n\\s*echo ""\\n\\s*if \\[ -z "\\$API_TOKEN" \\]; then\\n\\s*read -r -s -p "Registration token \\(required\\): " API_TOKEN\\n\\s*echo ""\\n\\s*fi\\n?/g, "");
                        } else if (selectedScript === "powershell") {
                          script = script.replace(/YOUR_TOKEN_HERE/g, userToken);
                          script = script.replace(/\$Token = "__PURVEX_TOKEN_VALUE__"/g, `$Token = "${userToken}"`);
                        } else {
                          script = script.replace(/YOUR_TOKEN_HERE/g, userToken);
                          script = script.replace(/--token YOUR_TOKEN_HERE/g, `--token ${userToken}`);
                        }

                        const blob = new Blob([script], { type: "text/plain" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        const filename = selectedScript === "bash" ? "register_agent.sh" : selectedScript === "powershell" ? "register_agent.ps1" : "register_agent.py";
                        a.download = filename;
                        a.rel = "noopener";
                        a.style.display = "none";
                        document.body.appendChild(a);
                        requestAnimationFrame(() => {
                          a.click();
                          document.body.removeChild(a);
                          setTimeout(() => URL.revokeObjectURL(url), 1500);
                        });

                        toast({
                          type: "success",
                          title: "Script downloaded",
                          description:
                            selectedScript === "bash"
                              ? `${filename} downloaded with your registration token. Run: chmod +x ${filename}`
                              : `${filename} has been downloaded with your registration token pre-configured.`,
                        });
                        setShowRegisterDialog(false);
                      } catch (err: any) {
                        toast({
                          type: "error",
                          title: "Download failed",
                          description: err?.message || "Unable to download script. Please try again.",
                        });
                      }
                    }}
                    disabled={tokenLoading || !userToken}
                    variant="outline"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Script
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!deleteEndpoint} onOpenChange={(open) => !open && setDeleteEndpoint(null)}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-slate-900">
                  Remove endpoint
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-600 mt-2">
                  This will remove <span className="font-semibold text-slate-900">{deleteEndpoint?.name}</span> from your lab. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteEndpoint(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!deleteEndpoint) return;
                    handleDeleteEndpoint(deleteEndpoint.id);
                    setDeleteEndpoint(null);
                  }}
                >
                  Remove
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!pauseEndpoint} onOpenChange={(open) => !open && setPauseEndpoint(null)}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-slate-900">
                  Pause agent
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-600 mt-2">
                  This will pause <span className="font-semibold text-slate-900">{pauseEndpoint?.name}</span>. The agent will stop running new tests until resumed.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setPauseEndpoint(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!pauseEndpoint) return;
                    handlePauseEndpoint(pauseEndpoint.id);
                    setPauseEndpoint(null);
                  }}
                >
                  Pause Agent
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!resumeEndpoint} onOpenChange={(open) => !open && setResumeEndpoint(null)}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-slate-900">
                  Resume agent
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-600 mt-2">
                  This will resume <span className="font-semibold text-slate-900">{resumeEndpoint?.name}</span> and allow tests to run again.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setResumeEndpoint(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!resumeEndpoint) return;
                    handleResumeEndpoint(resumeEndpoint.id);
                    setResumeEndpoint(null);
                  }}
                >
                  Resume Agent
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {currentTest && (
            <Card className="transition-all duration-300 hover:border-slate-600/50">
              <CardHeader className="border-b border-slate-200 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-display font-bold text-white flex items-center gap-2">
                      <Play className="h-4 w-4 text-sky-400" />
                      Lab Run #{currentTest.id}
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs text-slate-400">
                      View-only status of this lab execution and SIEM validation
                    </CardDescription>
                  </div>
                  <Badge className={cn(
                    currentTest.status === "completed" && "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
                    currentTest.status === "running" && "bg-sky-500/20 text-sky-300 border-sky-500/40",
                    currentTest.status === "error" && "bg-red-500/20 text-red-300 border-red-500/40",
                    "bg-slate-500/20 text-slate-300 border-slate-500/40 transition-all duration-300 hover:scale-105"
                  )}>
                    {currentTest.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4 text-xs font-body text-slate-700">
                {/* Timeline / progress strip */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-display font-semibold uppercase tracking-wider text-slate-400">Execution timeline</span>
                    <span className="text-[10px] font-body text-slate-300">
                      {labStatus === "pending" && "Queued in lab…"}
                      {labStatus === "running" && "Running atomic test in lab…"}
                      {labStatus !== "pending" && labStatus !== "running" && "Run completed."}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden border border-slate-200 transition-all duration-300">
                    <div
                      className="h-full bg-gradient-to-r from-sky-400 via-emerald-400 to-sky-500 transition-all duration-700 ease-out"
                      style={{ width: `${Math.round(labProgress * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] font-body text-slate-500">
                    <span>Queued</span>
                    <span>Executing</span>
                    <span>SIEM validation</span>
                    <span>Completed</span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500">
                      Status
                    </p>
                    <p className="text-base font-display font-bold text-white">{currentTest.status}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500">
                      Environment
                    </p>
                    <p className="text-base font-display font-bold text-white">
                      {currentTest.environment
                        ? (currentTest.environment === "lab"
                          ? "Lab (PurveX)"
                          : currentTest.environment.toUpperCase())
                        : "UNKNOWN"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500">
                      Result
                    </p>
                    <p className="text-base font-display font-bold text-white">
                      {currentTest.result ?? "Pending"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                          <Activity className="h-3.5 w-3.5" />
                          Telemetry
                        </div>
                        <p className="text-sm font-body text-slate-700">
                          Logs present:{" "}
                          <span className="font-display font-semibold text-white">
                            {(() => {
                              try {
                                const raw = currentTest.artifact?.siem_sample_events || "[]";
                                const parsed = JSON.parse(raw);
                                return Array.isArray(parsed) ? (parsed.length > 0 ? "Yes" : "No") : "Yes";
                              } catch {
                                return "Unknown";
                              }
                            })()}
                          </span>
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5" />
                          Detection
                        </div>
                        <p className="text-sm font-body text-slate-700">
                          Linked detection:{" "}
                          <span className="font-display font-semibold text-white">
                            {currentTest.detection?.title ?? "None (telemetry-only run)"}
                          </span>
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {testError && (
                  <div className="flex items-start gap-2 rounded-lg border-2 border-amber-500/40 bg-amber-500/5 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5" />
                    <p className="text-xs font-body text-amber-300">{testError}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </PageContainer>
  );
}

export default function LabPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LabPageContent />
    </Suspense>
  );
}
