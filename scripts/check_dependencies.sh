#!/bin/bash
# Dependency vulnerability scanning script for PurveX
# Checks both Python and Node.js dependencies

set -e

echo "🔒 Running dependency vulnerability scans..."

# Check Python dependencies with safety
if command -v safety &> /dev/null; then
    echo "📦 Scanning Python dependencies with safety..."
    cd backend
    safety check --json || safety check
    cd ..
else
    echo "⚠️  safety not installed. Install with: pip install safety"
    echo "   Or run: pip install safety && safety check"
fi

# Check Node.js dependencies with npm audit
if command -v npm &> /dev/null; then
    echo "📦 Scanning Node.js dependencies with npm audit..."
    cd frontend
    npm audit --audit-level=moderate || true
    cd ..
else
    echo "⚠️  npm not found. Skipping Node.js dependency scan."
fi

echo "✅ Dependency scanning complete!"

