# PowerShell script to run security tests and linting

Write-Host "Running security tests..." -ForegroundColor Green

# Run pytest
Write-Host "Running unit tests..." -ForegroundColor Cyan
pytest tests/ -v --tb=short
if ($LASTEXITCODE -ne 0) {
    Write-Host "Tests failed!" -ForegroundColor Red
    exit 1
}

# Run bandit
Write-Host "Running bandit security linting..." -ForegroundColor Cyan
bandit -r app/ -ll
if ($LASTEXITCODE -ne 0) {
    Write-Host "Bandit found issues!" -ForegroundColor Yellow
    # Don't fail on bandit warnings, just report them
}

# Run safety
Write-Host "Running safety dependency check..." -ForegroundColor Cyan
safety check
if ($LASTEXITCODE -ne 0) {
    Write-Host "Safety found vulnerabilities!" -ForegroundColor Yellow
    # Don't fail on safety warnings, just report them
}

Write-Host "All security tests completed!" -ForegroundColor Green

