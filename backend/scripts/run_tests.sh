#!/bin/bash
# Run security tests and linting

set -e

echo "Running security tests..."

# Run pytest
echo "Running unit tests..."
pytest tests/ -v --tb=short

# Run bandit
echo "Running bandit security linting..."
bandit -r app/ -ll

# Run safety
echo "Running safety dependency check..."
safety check

echo "All security tests passed!"

