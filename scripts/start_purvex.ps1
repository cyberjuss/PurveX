# Start PurveX application (Ollama + Backend)
# This script starts both Ollama and the PurveX backend

param(
    [switch]$SkipOllama
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PurveX Startup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get the project root directory
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# Step 1: Start Ollama if not skipped
if (-not $SkipOllama) {
    Write-Host "[1/2] Starting Ollama..." -ForegroundColor Yellow
    & "$PSScriptRoot\start_ollama.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Failed to start Ollama. Continuing anyway..." -ForegroundColor Red
    }
    Write-Host ""
} else {
    Write-Host "[1/2] Skipping Ollama startup (--SkipOllama flag)" -ForegroundColor Yellow
    Write-Host ""
}

# Step 2: Start PurveX Backend
Write-Host "[2/2] Starting PurveX Backend..." -ForegroundColor Yellow

$venvPython = Join-Path $projectRoot "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "✗ Error: Virtual environment not found at: $venvPython" -ForegroundColor Red
    Write-Host "  Please create a virtual environment first." -ForegroundColor Yellow
    exit 1
}

$backendDir = Join-Path $projectRoot "backend"
if (-not (Test-Path $backendDir)) {
    Write-Host "✗ Error: Backend directory not found at: $backendDir" -ForegroundColor Red
    exit 1
}

Write-Host "  Starting FastAPI server on http://127.0.0.1:8001..." -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

Set-Location $backendDir
& $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload

