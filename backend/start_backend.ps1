# Stop any processes using ports 8001 or 8002
Write-Host "Stopping processes on ports 8001 and 8002..." -ForegroundColor Yellow

$ports = @(8001, 8002)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        $procId = $conn.OwningProcess
        if ($procId) {
            Write-Host "  Stopping process $procId on port $port" -ForegroundColor Cyan
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "Waiting for ports to release..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Activate venv and start backend on port 8001
Write-Host "Starting backend on port 8001..." -ForegroundColor Green

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Activate virtual environment
if (Test-Path "venv\Scripts\Activate.ps1") {
    & "venv\Scripts\Activate.ps1"
} else {
    Write-Host "Warning: venv not found. Using system Python." -ForegroundColor Yellow
}

# Start the backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001


























