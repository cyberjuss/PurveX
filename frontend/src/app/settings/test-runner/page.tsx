"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, Edit, Trash, HeartPulse, ServerCog, Terminal, Monitor, Code, Download, CheckCircle2, Copy as CopyIcon, Info } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

interface EnvironmentRunnerConfig {
  id: number;
  environment_name: string;
  runner_type: string;
  hostname?: string;
  port: number;
  username?: string;
  auth_method: string;
  key_path?: string;
  allowed_test_types: string; // JSON string
  max_concurrent_tests: number;
  heartbeat_interval_seconds: number;
  alert_offline_minutes: number;
}

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
  "alert_offline_minutes": 5
}
EOF
)

echo "Connecting to PurveX at: $API_URL"
echo "Registering agent:"
echo "  Hostname: $HOSTNAME"
echo "  IP Address: $LOCAL_IP"
echo "  Environment: $ENV"
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
    [string]$Username = $env:USERNAME
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
} | ConvertTo-Json

Write-Host "Connecting to PurveX at: $ApiUrl" -ForegroundColor Cyan
Write-Host "Registering agent:" -ForegroundColor Cyan
Write-Host "  Hostname: $Hostname" -ForegroundColor White
Write-Host "  IP Address: $LocalIP" -ForegroundColor White
Write-Host "  Environment: $Env" -ForegroundColor White
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
        "alert_offline_minutes": 5
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

export default function TestRunnerSettingsPage() {
  const [configs, setConfigs] = useState<EnvironmentRunnerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<EnvironmentRunnerConfig | null>(null);
  const [formData, setFormData] = useState<Partial<EnvironmentRunnerConfig>>({
    environment_name: "",
    runner_type: "SSH",
    port: 22,
    auth_method: "key",
    allowed_test_types: '["Atomic only"]',
    max_concurrent_tests: 1,
    heartbeat_interval_seconds: 5,
    alert_offline_minutes: 5,
  });
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const [connectionType, setConnectionType] = useState<"agent" | "ssh">("agent");
  const [selectedScript, setSelectedScript] = useState<"bash" | "powershell" | "python">("bash");
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [tokenExpiresInMinutes, setTokenExpiresInMinutes] = useState<number | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(1);

  useEffect(() => {
    fetchConfigs();
    // Auto-generate registration token for seamless registration
    let cancelled = false;
    async function generateToken() {
      try {
        setTokenLoading(true);
        const response = await apiFetch("/settings/agent-registration-token", {
          method: "POST",
        });
        if (!cancelled && response?.token) {
          setUserToken(response.token);
          if (response?.expires_in_minutes) {
            setTokenExpiresInMinutes(response.expires_in_minutes);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn("Failed to generate registration token:", err);
        }
      } finally {
        if (!cancelled) {
          setTokenLoading(false);
        }
      }
    }
    generateToken();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const data = await apiFetch("/settings/environment-runners");
      setConfigs(data);
    } catch (err: any) {
      setError(err.message || "Failed to load environment runner configurations.");
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id: keyof EnvironmentRunnerConfig, value: string | number) => {
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.environment_name || !formData.runner_type || !formData.auth_method) {
      setError("Please fill in all required fields.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editingConfig) {
        await apiFetch(`/settings/environment-runners/${editingConfig.id}`, {
          method: "PUT",
          body: JSON.stringify(formData),
        });
      } else {
        const created = await apiFetch("/settings/environment-runners", {
          method: "POST",
          body: JSON.stringify(formData),
        });
        if (typeof window !== "undefined" && created?.id) {
          const storedIds: number[] = JSON.parse(
            window.localStorage.getItem("purvex_platform_runner_ids") || "[]"
          );
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          const storedNotifications = JSON.parse(
            window.localStorage.getItem("purvex_platform_notifications") || "[]"
          ).filter((item: any) => new Date(item.timestamp).getTime() >= cutoff);
          const notification = {
            id: `platform-runner-${created.id}-${Date.now()}`,
            type: "platform",
            title: "New runner registered",
            description: `${created.hostname || "Runner"} · ${(created.environment_name || "unknown").toUpperCase()}`,
            timestamp: new Date().toISOString(),
            status: "success",
            actionUrl: "/settings/test-runner",
            metadata: {
              environment: created.environment_name,
            },
          };
          const mergedNotifications = [notification, ...storedNotifications].slice(0, 50);
          const mergedIds = Array.from(new Set([...storedIds, created.id]));
          window.localStorage.setItem("purvex_platform_notifications", JSON.stringify(mergedNotifications));
          window.localStorage.setItem("purvex_platform_runner_ids", JSON.stringify(mergedIds));
          window.dispatchEvent(new Event("purvex:platform-notification"));
        }
      }
      setFormData({
        environment_name: "",
        runner_type: "SSH",
        port: 22,
        auth_method: "key",
        allowed_test_types: '["Atomic only"]',
        max_concurrent_tests: 1,
        heartbeat_interval_seconds: 5,
        alert_offline_minutes: 5,
      });
      setShowAddForm(false);
      setEditingConfig(null);
      fetchConfigs(); // Re-fetch configs after save
    } catch (err: any) {
      setError(err.message || "Failed to save environment runner configuration.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (config: EnvironmentRunnerConfig) => {
    setEditingConfig(config);
    setFormData(config);
    setShowAddForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this environment runner configuration?")) return;
    try {
      await apiFetch(`/settings/environment-runners/${id}`, {
        method: "DELETE",
      });
      fetchConfigs();
    } catch (err: any) {
      setError(err.message || "Failed to delete environment runner configuration.");
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading test runner settings…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Error loading test runner settings: {error}
      </div>
    );
  }

  return (
    <PageContainer maxWidth="xl" className="space-y-8">
      <PageHeader
        eyebrow="Runner setup"
        title="Test Runner"
        subtitle="Connect lab endpoints and keep agent health in sync with PurveX."
        icon={<ServerCog className="h-5 w-5" />}
      />
      {/* Step Progress Indicator */}
      <div className="flex justify-center">
        {connectionType === "agent" ? (
          <div className="relative w-full max-w-5xl px-6">
            <div className="absolute top-[32px] left-[12.5%] w-[25%] h-[4px] rounded-full bg-slate-200" />
            <div className="absolute top-[32px] left-[37.5%] w-[25%] h-[4px] rounded-full bg-slate-200" />
            <div className="absolute top-[32px] left-[62.5%] w-[25%] h-[4px] rounded-full bg-slate-200" />
            <div
              className={cn(
                "absolute top-[32px] left-[12.5%] w-[25%] h-[4px] rounded-full transition-colors",
                currentStep > 1 ? "bg-indigo-200" : "bg-slate-200"
              )}
            />
            <div
              className={cn(
                "absolute top-[32px] left-[37.5%] w-[25%] h-[4px] rounded-full transition-colors",
                currentStep > 2 ? "bg-indigo-200" : "bg-slate-200"
              )}
            />
            <div
              className={cn(
                "absolute top-[32px] left-[62.5%] w-[25%] h-[4px] rounded-full transition-colors",
                currentStep > 3 ? "bg-indigo-200" : "bg-slate-200"
              )}
            />

            <div className="relative z-10 grid grid-cols-4 items-start text-center">
              {[
                { step: 1, label: "Connection" },
                { step: 2, label: "Platform" },
                { step: 3, label: "Download" },
                { step: 4, label: "Run" },
              ].map((item) => {
                const isActive = currentStep === item.step;
                const isCompleted = currentStep > item.step;
                return (
                  <div key={item.step} className="flex flex-col items-center gap-3">
                    <div
                      className={cn(
                        "flex items-center justify-center w-16 h-16 rounded-full border-2 transition-all bg-white shadow-sm",
                        isCompleted
                          ? "border-indigo-400 text-indigo-500 bg-indigo-50"
                          : isActive
                          ? "border-[#5b7bff] text-[#4d6dff] shadow-[0_0_0_4px_rgba(91,123,255,0.18)]"
                          : "border-slate-200 text-slate-400"
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-7 w-7" />
                      ) : (
                        <span className="text-2xl font-display font-bold">{item.step}</span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-base font-medium",
                        isActive ? "text-[#4d6dff]" : "text-slate-500"
                      )}
                    >
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="relative w-full max-w-4xl px-6">
            <div className="absolute top-[32px] left-[25%] w-[50%] h-[4px] rounded-full bg-slate-200" />
            <div
              className={cn(
                "absolute top-[32px] left-[25%] w-[50%] h-[4px] rounded-full transition-colors",
                currentStep > 1 ? "bg-indigo-200" : "bg-slate-200"
              )}
            />

            <div className="relative z-10 grid grid-cols-2 items-start text-center">
              {[
                { step: 1, label: "Connection" },
                { step: 2, label: "Configuration" },
              ].map((item) => {
                const isActive = currentStep === item.step;
                const isCompleted = currentStep > item.step;
                return (
                  <div key={item.step} className="flex flex-col items-center gap-3">
                    <div
                      className={cn(
                        "flex items-center justify-center w-16 h-16 rounded-full border-2 transition-all bg-white shadow-sm",
                        isCompleted
                          ? "border-indigo-400 text-indigo-500 bg-indigo-50"
                          : isActive
                          ? "border-[#5b7bff] text-[#4d6dff] shadow-[0_0_0_4px_rgba(91,123,255,0.18)]"
                          : "border-slate-200 text-slate-400"
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-7 w-7" />
                      ) : (
                        <span className="text-2xl font-display font-bold">{item.step}</span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-base font-medium",
                        isActive ? "text-[#4d6dff]" : "text-slate-500"
                      )}
                    >
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {/* Unified Connection Card - Agent or SSH */}
      <Card className="border border-slate-200 shadow-lg shadow-slate-200/50 rounded-2xl bg-white overflow-hidden">
        <CardContent className="pt-6">
          <div className="space-y-8">
          {/* Step 1 - Choose Connection Type - Always visible */}
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-sm font-bold">
                    1
                  </span>
                  Choose Connection Type
                </h2>
                <p className="text-sm text-slate-600 ml-9">
                  Select how you want to connect your test runner
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 ml-9">
              <button
                onClick={() => {
                  setConnectionType("agent");
                  setShowAddForm(false);
                  if (currentStep === 1) {
                    setCurrentStep(2);
                  }
                }}
                className={cn(
                  "group relative px-4 py-3 text-sm font-medium transition-all duration-200 rounded-xl flex items-center gap-3 border-2",
                  connectionType === "agent"
                    ? "bg-[#f5f7ff] text-[#4d6dff] border-[#5b7bff] shadow-[0_0_0_3px_rgba(91,123,255,0.18)]"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-[#f5f7ff] hover:border-[#5b7bff] hover:text-[#4d6dff] hover:shadow-md"
                )}
              >
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center transition-all duration-200 shadow-sm",
                  connectionType === "agent" 
                    ? "bg-[#5b7bff] text-white shadow-[0_8px_18px_rgba(91,123,255,0.35)]" 
                    : "bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                )}>
                  <ServerCog className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <span className="font-semibold text-sm block">Agent</span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">Register with script</span>
                </div>
                {connectionType === "agent" && (
                  <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#5b7bff] animate-pulse"></div>
                )}
              </button>
              <button
                onClick={() => {
                  setConnectionType("ssh");
                  setShowAddForm(true);
                  setEditingConfig(null);
                  setFormData({
                    environment_name: "",
                    runner_type: "SSH",
                    port: 22,
                    auth_method: "key",
                    allowed_test_types: '["Atomic only"]',
                    max_concurrent_tests: 1,
                    heartbeat_interval_seconds: 5,
                    alert_offline_minutes: 5,
                  });
                  if (currentStep === 1) {
                    setCurrentStep(2);
                  }
                }}
                className={cn(
                  "group relative px-4 py-3 text-sm font-medium transition-all duration-200 rounded-xl flex items-center gap-3 border-2",
                  connectionType === "ssh"
                    ? "bg-gradient-to-br from-indigo-50 via-purple-50 to-indigo-50 text-indigo-700 border-indigo-300 shadow-lg ring-2 ring-indigo-100"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-[#f5f7ff] hover:border-[#5b7bff] hover:text-[#4d6dff] hover:shadow-md"
                )}
              >
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center transition-all duration-200 shadow-sm",
                  connectionType === "ssh" 
                    ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md" 
                    : "bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                )}>
                  <Terminal className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <span className="font-semibold text-sm block">SSH</span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">Manual configuration</span>
                </div>
                {connectionType === "ssh" && (
                  <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></div>
                )}
              </button>
            </div>
          </div>

          {/* Agent Registration Flow - Step 2: Choose Platform */}
          {connectionType === "agent" && currentStep >= 2 && (
            <div className="space-y-8 pt-4 border-t border-slate-200 animate-fade-in-scale">
              {/* Step 2 - Choose Platform */}
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-sm font-bold">
                        2
                      </span>
                      Choose Your Platform
                    </h2>
                    <p className="text-sm text-slate-600 ml-9">Select your operating system or runtime</p>
                  </div>
                </div>
                
                {/* Operating System Options */}
                <div className="space-y-4 ml-9">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
                    <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider px-3">Operating System</span>
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        setSelectedScript("bash");
                        setCopied(false);
                        setCurrentStep(3);
                      }}
                      className={cn(
                        "group relative px-4 py-3 text-sm font-medium transition-all duration-200 rounded-xl flex items-center gap-3",
                        "border-2",
                        selectedScript === "bash"
                          ? "bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-700 border-indigo-300 shadow-md ring-2 ring-indigo-100"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-indigo-200 hover:text-slate-700 hover:shadow-sm"
                      )}
                    >
                      <div className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center transition-all duration-200 shadow-sm",
                        selectedScript === "bash" 
                          ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md" 
                          : "bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                      )}>
                        <Terminal className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <span className="font-semibold text-sm block">Linux/Unix</span>
                        <span className="text-[11px] text-slate-500 mt-0.5 block">Bash</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setSelectedScript("powershell");
                        setCopied(false);
                        setCurrentStep(3);
                      }}
                      className={cn(
                        "group relative px-4 py-3 text-sm font-medium transition-all duration-200 rounded-xl flex items-center gap-3",
                        "border-2",
                        selectedScript === "powershell"
                          ? "bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-700 border-indigo-300 shadow-md ring-2 ring-indigo-100"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-indigo-200 hover:text-slate-700 hover:shadow-sm"
                      )}
                    >
                      <div className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center transition-all duration-200 shadow-sm",
                        selectedScript === "powershell" 
                          ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md" 
                          : "bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                      )}>
                        <Monitor className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <span className="font-semibold text-sm block">Windows</span>
                        <span className="text-[11px] text-slate-500 mt-0.5 block">PowerShell</span>
                      </div>
                    </button>
              </div>
            </div>

            {/* Python Runtime Option */}
            <div className="space-y-2 ml-9 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-0.5 mb-0.5">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent"></div>
                <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-wider px-0.5">Runtime</span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setSelectedScript("python");
                    setCopied(false);
                    setCurrentStep(3);
                  }}
                  className={cn(
                    "group relative px-4 py-3 text-sm font-medium transition-all duration-300 rounded-xl flex items-center gap-3 justify-start border-2",
                    "border",
                    selectedScript === "python"
                      ? "bg-gradient-to-br from-indigo-50 via-purple-50 to-indigo-50 text-indigo-700 border-indigo-300 shadow-lg ring-2 ring-indigo-100"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-indigo-200 hover:text-slate-700 hover:shadow-md"
                  )}
                >
                  <div className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center transition-all duration-200 shadow-sm",
                    selectedScript === "python" 
                      ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md" 
                      : "bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                  )}>
                    <Code className={cn(
                      "h-5 w-5 transition-colors duration-300",
                      selectedScript === "python" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"
                    )} />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-sm block">Python</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 block">Cross-platform</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
            </div>
          )}

          {/* Step 3 - Download Script */}
          {connectionType === "agent" && currentStep >= 3 && (
                <div className="space-y-4 pt-4 border-t border-slate-200 animate-fade-in-scale">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-sm font-bold">
                          3
                        </span>
                        Download Script
                      </h2>
                      <p className="text-sm text-slate-600 ml-9">Get your registration script with token pre-configured</p>
                    </div>
                  </div>
                  <div className="ml-9">
                    <div className="p-5 rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white hover:border-indigo-200 transition-all duration-200 shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md flex-shrink-0">
                          <Download className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <p className="text-base font-semibold text-slate-900 font-mono">
                              {selectedScript === "bash" && "register_agent.sh"}
                              {selectedScript === "powershell" && "register_agent.ps1"}
                              {selectedScript === "python" && "register_agent.py"}
                            </p>
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-medium">
                              {selectedScript === "bash" && "Bash"}
                              {selectedScript === "powershell" && "PowerShell"}
                              {selectedScript === "python" && "Python"}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            Token pre-configured • Ready to download
                          </p>
                          {selectedScript === "bash" && (
                            <p className="text-xs text-slate-500">
                              Note: browsers can’t set execute permissions. After download, run{" "}
                              <span className="font-mono">chmod +x register_agent.sh</span>.
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (tokenLoading) {
                              toast({
                                type: "warning",
                                title: "Token still generating",
                                description: "Please wait for the registration token to be generated.",
                              });
                              return;
                            }
                            try {
                              const apiUrl = getApiUrl();
                              let script = getAgentScript(selectedScript, apiUrl);

                              if (userToken) {
                                script = script.replace(/__PURVEX_TOKEN_VALUE__/g, userToken);
                                script = script.replace(/YOUR_TOKEN_HERE/g, userToken);
                                script = script.replace(/API_TOKEN="YOUR_TOKEN_HERE"/g, `API_TOKEN="${userToken}"`);
                                script = script.replace(/\$Token = "__PURVEX_TOKEN_VALUE__"/g, `$Token = "${userToken}"`);
                                script = script.replace(/--token YOUR_TOKEN_HERE/g, `--token ${userToken}`);
                                if (selectedScript === "bash") {
                                  script = script.replace(/read -r -s -p "Registration token \\(paste and press Enter\\): " API_TOKEN\\n\\s*echo ""\\n\\s*if \\[ -z "\\$API_TOKEN" \\]; then\\n\\s*read -r -s -p "Registration token \\(required\\): " API_TOKEN\\n\\s*echo ""\\n\\s*fi\\n?/g, "");
                                }
                              } else {
                                toast({
                                  type: "warning",
                                  title: "Token not available",
                                  description: "Downloaded script without a token. Add your token before running.",
                                });
                              }

                              const blob = new Blob([script], { type: "text/plain" });
                              const filename = selectedScript === "bash" ? "register_agent.sh" : selectedScript === "powershell" ? "register_agent.ps1" : "register_agent.py";
                              if (typeof window !== "undefined" && (window.navigator as any)?.msSaveOrOpenBlob) {
                                (window.navigator as any).msSaveOrOpenBlob(blob, filename);
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
                                  // No fallback navigation: avoid opening the script in a new tab.
                                });
                              }

                              toast({
                                type: "success",
                                title: "Script downloaded",
                                description:
                                  selectedScript === "bash"
                                    ? `${filename} downloaded with your registration token. Run: chmod +x ${filename}`
                                    : `${filename} has been downloaded with your registration token pre-configured.`,
                              });
                              setCurrentStep(4);
                            } catch (err) {
                              toast({
                                type: "error",
                                title: "Download failed",
                                description: err?.message || "Unable to download script. Please try again.",
                              });
                            }
                          }}
                          className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-600 cursor-pointer transition-all duration-300 shadow-sm hover:scale-105 flex items-center justify-center flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                          title={`Download ${selectedScript === "bash" ? "register_agent.sh" : selectedScript === "powershell" ? "register_agent.ps1" : "register_agent.py"}`}
                          aria-label={`Download ${selectedScript === "bash" ? "Bash" : selectedScript === "powershell" ? "PowerShell" : "Python"} registration script`}
                          disabled={tokenLoading}
                        >
                          <Download className={cn("h-4 w-4", tokenLoading && "opacity-50")} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Registration Token</p>
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-slate-900 break-all">
                              {tokenLoading && !userToken && "Generating token..."}
                              {!tokenLoading && !userToken && "Token unavailable. Refresh to retry."}
                              {userToken &&
                                (showToken
                                  ? userToken
                                  : `${userToken.slice(0, 6)}…${userToken.slice(-4)}`)}
                            </code>
                          </div>
                          {tokenExpiresInMinutes && (
                            <p className="text-[11px] text-slate-500">
                              Single-use token. Expires in {tokenExpiresInMinutes} minutes.
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            aria-label={showToken ? "Hide registration token" : "Reveal registration token"}
                            title={showToken ? "Hide token" : "Reveal token"}
                            className="inline-flex h-9 px-3 items-center justify-center rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 cursor-pointer transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => {
                              if (!userToken || tokenLoading) return;
                              setShowToken((prev) => !prev);
                            }}
                            disabled={!userToken || tokenLoading}
                          >
                            {showToken ? "Hide" : "Reveal"}
                          </button>
                          <button
                            type="button"
                            aria-label="Copy registration token"
                            title="Copy registration token"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:bg-indigo-600 hover:border-indigo-500 hover:text-white cursor-pointer transition-all duration-200 shadow-sm hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => {
                              if (!userToken || typeof navigator === "undefined" || !navigator.clipboard) {
                                return;
                              }
                              navigator.clipboard.writeText(userToken).then(() => {
                                setTokenCopied(true);
                                setTimeout(() => setTokenCopied(false), 2000);
                              }).catch(() => {});
                            }}
                            disabled={!userToken || tokenLoading}
                          >
                            {tokenCopied ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                            ) : (
                              <CopyIcon className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

          {/* Step 4 - Run Command */}
          {connectionType === "agent" && currentStep >= 4 && (
            <div className="space-y-4 pt-4 border-t border-slate-200 animate-fade-in-scale">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-sm font-bold">
                        4
                      </span>
                      Run Command
                    </h2>
                    <p className="text-sm text-slate-600 ml-9">Execute the command on your test runner</p>
                  </div>
                </div>
                  <div className="ml-9">
                    <div className="flex items-center justify-between gap-4 bg-white border-2 border-slate-200 rounded-xl p-4 shadow-sm">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-900">Command ready</p>
                        <p className="text-xs text-slate-600">Copy and run it on your test runner.</p>
                      </div>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="shrink-0 rounded-full bg-white px-4 text-slate-900 border border-slate-200 shadow-[0_12px_24px_rgba(15,23,42,0.12)] hover:bg-slate-50"
                        onClick={() => {
                          const apiUrl = getApiUrl();
                          let command = "";
                          if (userToken) {
                            if (selectedScript === "bash") {
                              command = `chmod +x register_agent.sh\nPURVEX_API_TOKEN=${userToken} ./register_agent.sh --api-url ${apiUrl} --env lab`;
                            } else if (selectedScript === "powershell") {
                              command = `$env:PURVEX_API_TOKEN=\"${userToken}\"; .\\register_agent.ps1 -ApiUrl \"${apiUrl}\" -Env \"lab\"`;
                            } else {
                              command = `python3 register_agent.py --api-url ${apiUrl} --token ${userToken} --env lab`;
                            }
                          } else {
                            if (selectedScript === "bash") {
                              command = `PURVEX_API_TOKEN=YOUR_TOKEN_HERE ./register_agent.sh --api-url ${apiUrl} --env lab`;
                            } else if (selectedScript === "powershell") {
                              command = `$env:PURVEX_API_TOKEN=\"YOUR_TOKEN_HERE\"; .\\register_agent.ps1 -ApiUrl \"${apiUrl}\" -Env \"lab\"`;
                            } else {
                              command = `python3 register_agent.py --api-url ${apiUrl} --token YOUR_TOKEN_HERE --env lab`;
                            }
                          }
                          if (typeof navigator !== "undefined" && navigator.clipboard) {
                            navigator.clipboard.writeText(command).then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }).catch(() => {});
                          }
                        }}
                      >
                        {copied ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Copied
                          </>
                        ) : (
                          <>
                            <CopyIcon className="h-4 w-4 mr-2" />
                            Copy command
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                {/* Advanced Section */}
                <div className="pt-4 border-t border-slate-200">
                  <details className="group">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-700 transition-all duration-200 py-2">
                        <span className="text-sm font-semibold">Advanced Settings</span>
                        <span className="text-xs text-slate-400 group-open:text-slate-600 transition-transform duration-200 group-open:rotate-180">▼</span>
                      </div>
                    </summary>
                    <div className="mt-3 ml-0 p-4 rounded-xl bg-slate-50 border border-slate-200 transition-all duration-200">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">API Endpoint</span>
                      </div>
                      <code className="text-sm font-mono text-indigo-700 break-all bg-white px-4 py-2.5 rounded-lg border border-slate-200 block shadow-sm">{getApiUrl()}</code>
                    </div>
                  </details>
                </div>
              </div>
            )}

          {/* SSH Configuration Flow - Step 2 */}
          {connectionType === "ssh" && currentStep === 2 && (
            <div className="space-y-4 pt-4 border-t border-slate-200 animate-fade-in-scale">
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                <h4 className="text-sm font-semibold text-slate-900 mb-2">SSH Runner Configuration</h4>
                <p className="text-xs text-slate-600 mb-4">Configure SSH connection details for your test runner.</p>
          {showAddForm && (
                <form onSubmit={handleFormSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Environment identity
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="environment_name">Environment name</Label>
                        <Input id="environment_name" value={formData.environment_name || ""} onChange={handleFormChange} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="allowed_test_types">Allowed test types (JSON array)</Label>
                        <Input id="allowed_test_types" value={formData.allowed_test_types} onChange={handleFormChange} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Connection
                    </p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2 md:col-span-1">
                        <Label htmlFor="runner_type">Runner type</Label>
                        <Select onValueChange={(value: string) => handleSelectChange("runner_type", value)} value={formData.runner_type}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select runner type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SSH">SSH</SelectItem>
                            <SelectItem value="Agent">Agent (coming soon)</SelectItem>
                            <SelectItem value="API">API (coming soon)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="hostname">Hostname / IP</Label>
                        <Input id="hostname" value={formData.hostname || ""} onChange={handleFormChange} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="port">Port</Label>
                        <Input id="port" type="number" value={formData.port || 22} onChange={handleFormChange} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Authentication
                    </p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input id="username" value={formData.username || ""} onChange={handleFormChange} />
                      </div>
                      <div className="space-y-2">
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
                      <div className="space-y-2 md:col-span-1 md:col-start-1 md:col-end-4">
                        <Label htmlFor="key_path">Key path (e.g., /path/to/private_key.pem)</Label>
                        <Input id="key_path" value={formData.key_path || ""} onChange={handleFormChange} />
                        <p className="text-[11px] text-muted-foreground">
                          For &quot;key&quot; auth, specify the private key path or map to a stored secret.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Limits &amp; health
                    </p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="max_concurrent_tests">Max concurrent tests</Label>
                        <Input id="max_concurrent_tests" type="number" value={formData.max_concurrent_tests} onChange={handleFormChange} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="heartbeat_interval_seconds">Heartbeat interval (sec)</Label>
                        <Input id="heartbeat_interval_seconds" type="number" value={formData.heartbeat_interval_seconds} onChange={handleFormChange} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="alert_offline_minutes">Alert if offline (min)</Label>
                        <Input id="alert_offline_minutes" type="number" value={formData.alert_offline_minutes} onChange={handleFormChange} />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="submit" disabled={isSaving}>
                      {isSaving ? "Saving…" : "Save configuration"}
                    </Button>
                    {editingConfig && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowAddForm(false);
                          setEditingConfig(null);
                          setFormData({});
                        }}
                        className="border-border text-foreground hover:bg-accent"
                      >
                        Cancel
                      </Button>
                    )}
                    <Button type="button" variant="secondary" disabled className="inline-flex items-center">
                      <HeartPulse className="mr-2 h-4 w-4" /> Runner health (coming soon)
                    </Button>
                  </div>
                </form>
                )}
              </div>
            </div>
          )}
          </div>
        </CardContent>
      </Card>

    </PageContainer>
  );
}
