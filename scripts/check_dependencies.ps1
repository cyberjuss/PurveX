# Dependency vulnerability scanning script for PurveX (Windows)
# Checks both Python and Node.js dependencies

Write-Host "🔒 Running dependency vulnerability scans..." -ForegroundColor Cyan

# Check Python dependencies with safety
if (Get-Command safety -ErrorAction SilentlyContinue) {
    Write-Host "📦 Scanning Python dependencies with safety..." -ForegroundColor Yellow
    Set-Location backend
    safety check
    Set-Location ..
} else {
    Write-Host "⚠️  safety not installed. Install with: pip install safety" -ForegroundColor Yellow
    Write-Host "   Or run: pip install safety && safety check" -ForegroundColor Yellow
}

# Check Node.js dependencies with npm audit
if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "📦 Scanning Node.js dependencies with npm audit..." -ForegroundColor Yellow
    Set-Location frontend
    npm audit --audit-level=moderate
    Set-Location ..
} else {
    Write-Host "⚠️  npm not found. Skipping Node.js dependency scan." -ForegroundColor Yellow
}

Write-Host "✅ Dependency scanning complete!" -ForegroundColor Green

