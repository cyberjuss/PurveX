# PurveX Agent Registration Script (PowerShell version)
# 
# This script can be copied and pasted onto any Windows sandbox or lab computer.
# It will automatically detect the machine's hostname/IP and register itself
# with the PurveX system as a test runner.
#
# Usage:
#   .\register_agent.ps1 -ApiUrl "http://your-server:8000" -Token "YOUR_TOKEN" -Env "lab"
#   .\register_agent.ps1 -ApiUrl "http://your-server:8000" -AdminUsername "admin" -AdminPassword "admin" -Env "lab"
#
# Or set environment variables:
#   $env:PURVEX_API_URL = "http://your-server:8000"
#   $env:PURVEX_API_TOKEN = "YOUR_TOKEN"
#   $env:PURVEX_ENV = "lab"
#   .\register_agent.ps1

param(
    [string]$ApiUrl = $env:PURVEX_API_URL,
    [string]$Token = $env:PURVEX_API_TOKEN,
    [string]$Env = $env:PURVEX_ENV,
    [string]$Hostname = $env:PURVEX_HOSTNAME,
    [int]$Port = 22,
    [string]$Username = $env:USERNAME
)

# Set defaults
if ([string]::IsNullOrEmpty($ApiUrl)) {
    $ApiUrl = "http://127.0.0.1:8001"
}

if ([string]::IsNullOrEmpty($Env)) {
    $Env = "lab"
}

$envProvided = $PSBoundParameters.ContainsKey('Env') -or (-not [string]::IsNullOrEmpty($env:PURVEX_ENV))
if (-not $envProvided) {
    $inputEnv = Read-Host "Environment [lab/dev/prod] ($Env)"
    if (-not [string]::IsNullOrEmpty($inputEnv)) {
        $Env = $inputEnv
    }
}

if ([string]::IsNullOrEmpty($Hostname)) {
    $Hostname = $env:COMPUTERNAME
}

if ([string]::IsNullOrEmpty($Username)) {
    $Username = $env:USERNAME
}

if ([string]::IsNullOrEmpty($Token)) {
    $inputApi = Read-Host "PurveX API URL [$ApiUrl]"
    if (-not [string]::IsNullOrEmpty($inputApi)) {
        $ApiUrl = $inputApi
    }
    $Token = Read-Host "Registration token"
}

# Validate required parameters
if ([string]::IsNullOrEmpty($Token)) {
    Write-Host "❌ ERROR: Registration token is required." -ForegroundColor Red
    Write-Host "   Provide it via -Token or set PURVEX_API_TOKEN." -ForegroundColor Yellow
    exit 1
}

# Get local IP address
function Get-LocalIP {
    $ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
    if ($ipAddresses) {
        return $ipAddresses[0].IPAddress
    }
    return "127.0.0.1"
}

$LocalIP = Get-LocalIP
$OsType = "windows"

# Prepare registration data
$RegistrationData = @{
    environment_name = $Env
    runner_type = "SSH"
    hostname = $Hostname
    port = $Port
    username = $Username
    auth_method = "key"
    allowed_test_types = '["Atomic only"]'
    max_concurrent_tests = 1
    heartbeat_interval_seconds = 5
    alert_offline_minutes = 5
} | ConvertTo-Json

# Display registration info
Write-Host "Connecting to PurveX at: $ApiUrl" -ForegroundColor Cyan
Write-Host "Registering agent:" -ForegroundColor Cyan
Write-Host "  Hostname: $Hostname" -ForegroundColor White
Write-Host "  IP Address: $LocalIP" -ForegroundColor White
Write-Host "  OS Type: $OsType" -ForegroundColor White
Write-Host "  Environment: $Env" -ForegroundColor White
Write-Host "  Port: $Port" -ForegroundColor White
Write-Host "  Username: $Username" -ForegroundColor White
Write-Host ""

# Make API request
$Url = "$($ApiUrl.TrimEnd('/'))/settings/environment-runners"
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
        Write-Host "   You may need to update the existing runner instead." -ForegroundColor Yellow
    }
    else {
        Write-Host "❌ ERROR: HTTP $StatusCode" -ForegroundColor Red
        if ($ErrorBody) {
            Write-Host "   Response: $ErrorBody" -ForegroundColor Yellow
        }
    }
    exit 1
}
