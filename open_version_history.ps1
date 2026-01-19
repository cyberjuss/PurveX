# Script to open version history for recently modified files
# This will open the version history dialog for each file that needs to be restored

$projectRoot = "C:\Users\jduru\OneDrive - Frostburg State University\PurveX"
$cutoff = (Get-Date).AddHours(-4)

# Get files modified in last 4 hours (excluding the restore script itself and build artifacts)
$filesToRestore = Get-ChildItem -Path $projectRoot -Recurse -File -ErrorAction SilentlyContinue | 
    Where-Object { 
        $_.LastWriteTime -gt $cutoff -and 
        $_.FullName -notmatch 'node_modules|venv|\.git|\.next|__pycache__|\.pyc|dist|build|\.log|restore_from_onedrive|open_version_history' 
    } | 
    Sort-Object LastWriteTime -Descending

Write-Host "Opening version history for $($filesToRestore.Count) files..." -ForegroundColor Green
Write-Host ""

foreach ($file in $filesToRestore) {
    $relativePath = $file.FullName.Replace($projectRoot + "\", "")
    Write-Host "Opening version history for: $relativePath" -ForegroundColor Cyan
    
    # Try to open the file's properties/version history
    # Method 1: Use shell to open file properties
    try {
        $shell = New-Object -ComObject Shell.Application
        $folder = $shell.Namespace($file.DirectoryName)
        $item = $folder.ParseName($file.Name)
        if ($item) {
            # This opens the properties dialog where version history can be accessed
            $item.InvokeVerb("properties")
            Start-Sleep -Milliseconds 500
        }
    } catch {
        Write-Host "  Could not open properties for: $relativePath" -ForegroundColor Yellow
        Write-Host "  Please manually right-click and select 'Version history'" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=" * 80
Write-Host "Alternative: Use OneDrive Web Interface for bulk restore" -ForegroundColor Yellow
Write-Host "=" * 80
Write-Host ""
Write-Host "1. Go to: https://onedrive.live.com"
Write-Host "2. Navigate to the PurveX folder"
Write-Host "3. You can restore the entire folder or individual files"
Write-Host "4. Look for 'Version history' option in the right-click menu"
Write-Host ""

