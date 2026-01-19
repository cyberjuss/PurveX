# OneDrive Version History Restore Script
# This script helps identify files modified in the last 3-4 hours
# and provides instructions for restoring from OneDrive version history

$cutoff = (Get-Date).AddHours(-4)
$projectRoot = "C:\Users\jduru\OneDrive - Frostburg State University\PurveX"

Write-Host "=" * 80
Write-Host "Files Modified in Last 4 Hours (to restore from OneDrive version history)"
Write-Host "=" * 80
Write-Host ""

# Get all modified files, excluding build artifacts and dependencies
$modifiedFiles = Get-ChildItem -Path $projectRoot -Recurse -File -ErrorAction SilentlyContinue | 
    Where-Object { 
        $_.LastWriteTime -gt $cutoff -and 
        $_.FullName -notmatch 'node_modules|venv|\.git|\.next|__pycache__|\.pyc|dist|build|\.log' 
    } | 
    Sort-Object LastWriteTime -Descending

if ($modifiedFiles.Count -eq 0) {
    Write-Host "No files found modified in the last 4 hours (excluding build artifacts)." -ForegroundColor Yellow
    Write-Host "Checking files modified in the last 6 hours..." -ForegroundColor Yellow
    $cutoff = (Get-Date).AddHours(-6)
    $modifiedFiles = Get-ChildItem -Path $projectRoot -Recurse -File -ErrorAction SilentlyContinue | 
        Where-Object { 
            $_.LastWriteTime -gt $cutoff -and 
            $_.FullName -notmatch 'node_modules|venv|\.git|\.next|__pycache__|\.pyc|dist|build|\.log' 
        } | 
        Sort-Object LastWriteTime -Descending
}

if ($modifiedFiles.Count -gt 0) {
    Write-Host "Found $($modifiedFiles.Count) file(s) modified recently:" -ForegroundColor Green
    Write-Host ""
    
    $modifiedFiles | ForEach-Object {
        $relativePath = $_.FullName.Replace($projectRoot + "\", "")
        $hoursAgo = [math]::Round(((Get-Date) - $_.LastWriteTime).TotalHours, 2)
        Write-Host "  [$hoursAgo hours ago] $relativePath" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "=" * 80
    Write-Host "To restore these files from OneDrive version history:" -ForegroundColor Yellow
    Write-Host "=" * 80
    Write-Host ""
    Write-Host "METHOD 1 - File Explorer (Recommended):" -ForegroundColor Green
    Write-Host "  1. Open File Explorer"
    Write-Host "  2. Navigate to: $projectRoot"
    Write-Host "  3. For each file listed above:"
    Write-Host "     a. Right-click the file"
    Write-Host "     b. Select 'Version history' or 'Restore previous versions'"
    Write-Host "     c. Choose the version from 3-4 hours ago"
    Write-Host "     d. Click 'Restore'"
    Write-Host ""
    Write-Host "METHOD 2 - OneDrive Web Interface:" -ForegroundColor Green
    Write-Host "  1. Go to: https://onedrive.live.com"
    Write-Host "  2. Navigate to: PurveX folder"
    Write-Host "  3. Right-click each file and select 'Version history'"
    Write-Host "  4. Restore the version from 3-4 hours ago"
    Write-Host ""
    Write-Host "METHOD 3 - Bulk Restore (if available):" -ForegroundColor Green
    Write-Host "  OneDrive may allow restoring the entire folder to a previous state"
    Write-Host "  Check OneDrive web interface for folder-level version history"
    Write-Host ""
} else {
    Write-Host "No recently modified source files found." -ForegroundColor Yellow
    Write-Host "The platform may not have been modified in the last 4-6 hours." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

