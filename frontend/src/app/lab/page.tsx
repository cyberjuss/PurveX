"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  return "http://localhost:8000";
}

// Helper function to get agent script content
function getAgentScript(type: "bash" | "powershell" | "python", apiUrl: string): string {
  if (type === "bash") {
    return `#!/bin/bash
# PurveX Agent Registration Script (Bash version)
# Copy and paste this onto any Linux/Unix sandbox or lab computer.

set -e

API_URL="${apiUrl}"
API_TOKEN="YOUR_TOKEN_HERE"
ENV="lab"
HOSTNAME=""
PORT="22"
USERNAME="${"${USER:-purvex}"}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url) API_URL="$2"; shift 2 ;;
        --token) API_TOKEN="$2"; shift 2 ;;
        --env) ENV="$2"; shift 2 ;;
        --hostname) HOSTNAME="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --username) USERNAME="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$API_TOKEN" ] || [ "$API_TOKEN" = "YOUR_TOKEN_HERE" ]; then
    echo "❌ ERROR: API token is required."
    echo "   Provide it via --token argument or set API_TOKEN variable"
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
  "auth_method": "key",
  "allowed_test_types": "[\\"Atomic only\\"]",
  "max_concurrent_tests": 1,
  "heartbeat_interval_seconds": 60,
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

if ! command -v curl >/dev/null 2>&1; then
    echo "❌ ERROR: 'curl' is required but not installed."
    echo "   Install it with: apt-get install curl (Debian/Ubuntu) or yum install curl (RHEL/CentOS)"
    exit 1
fi

URL="${apiUrl}/api/settings/environment-runners"
RESPONSE=$(curl -s -w "\\n%{http_code}" -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d "$REGISTRATION_DATA" "$URL" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Successfully registered with PurveX!"
    RUNNER_ID=$(echo "$BODY" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$RUNNER_ID" ]; then
        echo "   Runner ID: $RUNNER_ID"
    fi
elif [ "$HTTP_CODE" -eq 403 ]; then
    echo "❌ ERROR: Access denied. Check your API token and ensure you have admin privileges."
    exit 1
elif [ "$HTTP_CODE" -eq 409 ]; then
    echo "⚠️  WARNING: A runner with this hostname already exists."
    exit 1
else
    echo "❌ ERROR: HTTP $HTTP_CODE"
    echo "   Response: $BODY"
    exit 1
fi`;
  } else if (type === "powershell") {
    return `# PurveX Agent Registration Script (PowerShell version)
# Copy and paste this onto any Windows sandbox or lab computer.

param(
    [string]$ApiUrl = "${apiUrl}",
    [string]$Token = "YOUR_TOKEN_HERE",
    [string]$Env = "lab",
    [string]$Hostname = $env:COMPUTERNAME,
    [int]$Port = 22,
    [string]$Username = $env:USERNAME
)

if ([string]::IsNullOrEmpty($Token) -or $Token -eq "YOUR_TOKEN_HERE") {
    Write-Host "❌ ERROR: API token is required." -ForegroundColor Red
    Write-Host "   Provide it via -Token parameter" -ForegroundColor Yellow
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
    auth_method = "key"
    allowed_test_types = '["Atomic only"]'
    max_concurrent_tests = 1
    heartbeat_interval_seconds = 60
    alert_offline_minutes = 5
} | ConvertTo-Json

Write-Host "Connecting to PurveX at: $ApiUrl" -ForegroundColor Cyan
Write-Host "Registering agent:" -ForegroundColor Cyan
Write-Host "  Hostname: $Hostname" -ForegroundColor White
Write-Host "  IP Address: $LocalIP" -ForegroundColor White
Write-Host "  Environment: $Env" -ForegroundColor White
Write-Host ""

$Url = "$($ApiUrl.TrimEnd('/'))/api/settings/environment-runners"
$Headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type" = "application/json"
}

try {
    $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $RegistrationData -ContentType "application/json" -ErrorAction Stop
    Write-Host "✅ Successfully registered with PurveX!" -ForegroundColor Green
    Write-Host "   Runner ID: $($Response.id)" -ForegroundColor White
    Write-Host "   Environment: $($Response.environment_name)" -ForegroundColor White
    Write-Host "   Hostname: $($Response.hostname)" -ForegroundColor White
}
catch {
    $StatusCode = $_.Exception.Response.StatusCode.value__
    $ErrorBody = $_.ErrorDetails.Message
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
        "auth_method": "key",
        "allowed_test_types": '["Atomic only"]',
        "max_concurrent_tests": 1,
        "heartbeat_interval_seconds": 60,
        "alert_offline_minutes": 5
    }
    
    url = f"{api_url.rstrip('/')}/api/settings/environment-runners"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    
    print(f"Connecting to PurveX at: {api_url}")
    print(f"Registering agent:")
    print(f"  Hostname: {hostname}")
    print(f"  IP Address: {get_local_ip()}")
    print(f"  Environment: {environment}")
    print()
    
    try:
        response = requests.post(url, json=registration_data, headers=headers, timeout=30)
        response.raise_for_status()
        result = response.json()
        print("✅ Successfully registered with PurveX!")
        print(f"   Runner ID: {result.get('id')}")
        print(f"   Environment: {result.get('environment_name')}")
        print(f"   Hostname: {result.get('hostname')}")
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
    parser.add_argument('--token', default=os.getenv('PURVEX_API_TOKEN'), help='API authentication token (required)')
    parser.add_argument('--env', default=os.getenv('PURVEX_ENV', 'lab'), help='Environment name: lab, dev, or prod')
    parser.add_argument('--hostname', default=None, help='Custom hostname (auto-detected if not provided)')
    parser.add_argument('--port', type=int, default=22, help='SSH port (default: 22)')
    parser.add_argument('--username', default=None, help='SSH username (defaults to current user)')
    
    args = parser.parse_args()
    
    if not args.token:
        print("❌ ERROR: API token is required.")
        print("   Provide it via --token argument or PURVEX_API_TOKEN environment variable")
        sys.exit(1)
    
    register_agent(api_url=args.api_url, api_token=args.token, environment=args.env, hostname=args.hostname, port=args.port, username=args.username)

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
  const [tokenLoading, setTokenLoading] = useState(false);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(false);
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

  // Fetch environment runners/endpoints
  useEffect(() => {
    // Set mock data immediately for demo purposes
    const mockEndpoints = [
      {
        id: 1,
        hostname: "win-lab-01",
        os: "Windows 11",
        ipAddress: "10.0.0.5",
        status: "online",
        lastCheckIn: "2m ago",
        lastTestRun: "Atomic T1059.001",
        agentVersion: "v1.0.3",
        tags: ["workstation"],
        environment: "lab",
        runnerType: "SSH",
      },
      {
        id: 2,
        hostname: "ubuntu-honeypot",
        os: "Linux",
        ipAddress: "10.0.0.12",
        status: "degraded",
        lastCheckIn: "15m ago",
        lastTestRun: "Telemetry Check",
        agentVersion: "v1.0.2",
        tags: ["honeypot"],
        environment: "lab",
        runnerType: "SSH",
      },
      {
        id: 3,
        hostname: "dc01.lab",
        os: "Windows Server",
        ipAddress: "10.0.0.2",
        status: "idle",
        lastCheckIn: "1h ago",
        lastTestRun: "T1110 Password Spray",
        agentVersion: "v1.0.3",
        tags: ["domain-controller"],
        environment: "lab",
        runnerType: "SSH",
      },
    ];
    setEndpoints(mockEndpoints);
    
    async function fetchEndpoints() {
      try {
        setEndpointsLoading(true);
        const runners = await apiFetch("/settings/environment-runners", {
          cache: "no-store",
        });
        // Transform runners to endpoint format with enhanced data
        if (runners && Array.isArray(runners) && runners.length > 0) {
          const transformedEndpoints = runners.map((runner: any, index: number) => ({
            id: runner.id,
            hostname: runner.hostname || `endpoint-${runner.id}`,
            os: runner.runner_type === "SSH" ? (index % 2 === 0 ? "Linux" : "Windows Server") : "Linux",
            ipAddress: `10.0.0.${10 + index}`,
            status: index === 0 ? "online" : index === 1 ? "degraded" : "idle",
            lastCheckIn: index === 0 ? "2m ago" : index === 1 ? "15m ago" : "1h ago",
            lastTestRun: index === 0 ? "Atomic T1059.001" : index === 1 ? "Telemetry Check" : "T1110 Password Spray",
            agentVersion: `v1.0.${3 - (index % 3)}`,
            tags: index === 0 ? ["workstation"] : index === 1 ? ["honeypot"] : ["domain-controller"],
            environment: runner.environment_name || "lab",
            runnerType: runner.runner_type,
            port: runner.port,
            username: runner.username,
          }));
          setEndpoints(transformedEndpoints);
        }
      } catch (err) {
        console.error("Failed to fetch endpoints:", err);
        // Keep mock data on error
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
    <PageContainer maxWidth="full" className="p-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
          <div className="w-full pl-0.5 pr-0 sm:pr-0">
            <PageHeader
              title="Lab"
              subtitle="Experiment safely and validate detection changes"
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
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setShowRegisterDialog(true)}
                  className="h-10 px-5 rounded-full bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm text-xs font-semibold tracking-wide"
                >
                  <ServerCog className="h-4 w-4 mr-2" />
                  Install Agent
                </Button>
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
                                  "inline-flex items-center gap-2 border text-xs px-2.5 py-1 rounded-full"
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    endpoint.status === "online" && "bg-emerald-500",
                                    endpoint.status === "degraded" && "bg-amber-500",
                                    endpoint.status === "idle" && "bg-blue-500",
                                    endpoint.status !== "online" &&
                                      endpoint.status !== "degraded" &&
                                      endpoint.status !== "idle" &&
                                      "bg-slate-400"
                                  )}
                                />
                                <span className="font-semibold capitalize">{endpoint.status}</span>
                              </Badge>
                            </td>
                            <td className="py-3 px-3">
                              <span className="text-slate-900">{endpoint.lastCheckIn}</span>
                            </td>
                            <td className="py-3 px-3">
                              <span className="text-slate-900 truncate block">{endpoint.lastTestRun}</span>
                            </td>
                            <td className="py-3 px-3">
                              <Badge className="bg-slate-100 text-slate-800 border border-slate-200 text-xs px-2.5 py-1 rounded-full font-semibold">
                                {endpoint.agentVersion}
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
                              </div>
                            </td>
                          </tr>
                          {expandedRows.has(endpoint.id) && (
                            <tr className="bg-slate-50 animate-in fade-in slide-in-from-top-2 duration-300">
                              <td colSpan={9} className="py-4 px-4">
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
                                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs px-2 py-1 h-5">
                                          Healthy
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Event Collection</span>
                                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs px-2 py-1 h-5">
                                          Active
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Last Event</span>
                                        <span className="text-xs text-slate-900 font-mono">2m ago</span>
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
                                        <span className="text-xs text-slate-900 font-semibold">12</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Last Detection</span>
                                        <span className="text-xs text-slate-900 font-mono">T1059.001</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Coverage Score</span>
                                        <Badge className="bg-sky-100 text-sky-700 border-sky-300 text-xs px-2 py-1 h-5">
                                          87%
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
                                      <div className="p-2 rounded bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors">
                                        <div className="flex items-center justify-between mb-1.5">
                                          <span className="text-xs font-medium text-slate-900 truncate">Atomic T1059.001</span>
                                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs px-2 py-1 h-5">
                                            Pass
                                          </Badge>
                                        </div>
                                        <p className="text-[10px] text-slate-600">2m ago • Score: 85</p>
                                      </div>
                                      <div className="p-2 rounded bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors">
                                        <div className="flex items-center justify-between mb-1.5">
                                          <span className="text-xs font-medium text-slate-900 truncate">T1110 Password Spray</span>
                                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs px-2 py-1 h-5">
                                            Pass
                                          </Badge>
                                        </div>
                                        <p className="text-[10px] text-slate-600">1h ago • Score: 92</p>
                                      </div>
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
                                          {endpoint.environment}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Runner Type</span>
                                        <span className="text-xs text-slate-900 font-mono">{endpoint.runnerType || "SSH"}</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Drift Status</span>
                                        <div className="flex items-center gap-1.5">
                                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                          <span className="text-xs text-emerald-700">No drift</span>
                                        </div>
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
                  Download a registration script to register a new agent in your lab environment. The script will be pre-configured with your registration token.
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

                        // Auto-inject generated token
                        if (selectedScript === "bash") {
                          script = script.replace(/YOUR_TOKEN_HERE/g, userToken);
                          script = script.replace(/API_TOKEN="YOUR_TOKEN_HERE"/g, `API_TOKEN="${userToken}"`);
                        } else if (selectedScript === "powershell") {
                          script = script.replace(/YOUR_TOKEN_HERE/g, userToken);
                          script = script.replace(/\$Token = "YOUR_TOKEN_HERE"/g, `$Token = "${userToken}"`);
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
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        toast({
                          type: "success",
                          title: "Script downloaded",
                          description: `${filename} has been downloaded with your registration token pre-configured.`,
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
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Script
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {currentTest && (
            <Card className="transition-all duration-300 hover:border-slate-600/50">
              <CardHeader className="border-b border-slate-800/50 pb-3">
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
              <CardContent className="pt-4 space-y-4 text-xs font-body text-slate-200">
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
                  <div className="h-1.5 w-full rounded-full bg-slate-900/80 overflow-hidden border border-slate-800/50 transition-all duration-300">
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
                      {currentTest.environment === "lab"
                        ? "Lab (PurveX)"
                        : currentTest.environment.toUpperCase()}
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
                        <p className="text-sm font-body text-slate-200">
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
                        <p className="text-sm font-body text-slate-200">
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
  return <LabPageContent />;
}
