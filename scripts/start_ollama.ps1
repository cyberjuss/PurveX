# Start Ollama service if not already running
# This script checks if Ollama is running and starts it if needed

Write-Host "Checking if Ollama is running..." -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✓ Ollama is already running on http://127.0.0.1:11434" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Ollama is not running. Starting Ollama service..." -ForegroundColor Yellow
    
    # Check if ollama command exists
    $ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollamaPath) {
        Write-Host "✗ Error: 'ollama' command not found. Please install Ollama first." -ForegroundColor Red
        Write-Host "  Download from: https://ollama.ai" -ForegroundColor Yellow
        exit 1
    }
    
    # Start Ollama in the background
    Write-Host "Starting Ollama service..." -ForegroundColor Cyan
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    
    # Wait a few seconds for Ollama to start
    Write-Host "Waiting for Ollama to start..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
    
    # Verify it's running
    $maxRetries = 10
    $retryCount = 0
    while ($retryCount -lt $maxRetries) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 -ErrorAction Stop
            Write-Host "✓ Ollama started successfully on http://127.0.0.1:11434" -ForegroundColor Green
            exit 0
        } catch {
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Write-Host "  Retrying... ($retryCount/$maxRetries)" -ForegroundColor Yellow
                Start-Sleep -Seconds 2
            }
        }
    }
    
    Write-Host "✗ Failed to start Ollama after $maxRetries attempts" -ForegroundColor Red
    exit 1
}

