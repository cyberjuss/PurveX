"""
Small repository secret scanner for CI and local preflight checks.

This is intentionally conservative and scans only tracked files so local .env
files ignored by git do not create noise. It is not a replacement for a
dedicated scanner, but it blocks the highest-risk accidental commits.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKIP_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".db",
    ".pyc",
}

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("OpenAI/DeepSeek-style API key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    (
        "non-placeholder OPENAI_API_KEY",
        re.compile(r"(?im)^\s*OPENAI_API_KEY\s*=\s*(?!$|<|your-|changeme|placeholder)[^\s#]+"),
    ),
    (
        "non-placeholder JWT_SECRET_KEY",
        re.compile(r"(?im)^\s*JWT_SECRET_KEY\s*=\s*(?!$|<|your-|changeme|placeholder)[^\s#]{24,}"),
    ),
    (
        "non-placeholder PURVEX_ENCRYPTION_KEY",
        re.compile(r"(?im)^\s*PURVEX_ENCRYPTION_KEY\s*=\s*(?!$|<|your-|changeme|placeholder)[^\s#]{24,}"),
    ),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    files: list[Path] = []
    for raw in result.stdout.splitlines():
        path = ROOT / raw
        if not path.is_file():
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        files.append(path)
    return files


def main() -> int:
    findings: list[str] = []
    for path in tracked_files():
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        rel = path.relative_to(ROOT)
        for label, pattern in PATTERNS:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                findings.append(f"{rel}:{line}: potential {label}")

    if findings:
        print("Potential secrets found in tracked files:")
        for finding in findings:
            print(f"  {finding}")
        return 1

    print("No obvious secrets found in tracked files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
