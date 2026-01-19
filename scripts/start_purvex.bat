@echo off
REM Windows batch file to start PurveX (Ollama + Backend)
REM This is a convenience wrapper for PowerShell script

powershell.exe -ExecutionPolicy Bypass -File "%~dp0start_purvex.ps1" %*

