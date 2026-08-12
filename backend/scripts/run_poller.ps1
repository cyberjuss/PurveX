# Wrapper invoked by the Windows Scheduled Task "PurveX License Poller"
# (registered separately -- see the task's own description). Loads
# .env.license_poller (gitignored, filled in locally, never committed)
# into the process environment, then runs poll_license_issuance.py through
# the backend venv, appending output to a log file for later review.
#
# Not meant to be run interactively for real use, though it's safe to --
# it just drains whatever's currently pending. See poll_license_issuance.py
# for what it actually does and why it exists.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.license_poller"
$logFile = Join-Path $root ".license_poller.log"

if (-not (Test-Path $envFile)) {
    "$(Get-Date -Format o) ERROR: missing $envFile -- copy .env.license_poller.example and fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY." |
        Tee-Object -FilePath $logFile -Append
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

"$(Get-Date -Format o) --- poll start ---" | Add-Content -Path $logFile
& "$root\venv\Scripts\python.exe" "$root\scripts\poll_license_issuance.py" 2>&1 |
    Add-Content -Path $logFile
