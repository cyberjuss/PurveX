"""Build purvex.exe using PyInstaller.

Usage:
    python scripts/build_exe.py

Output:
    scripts/purvex.exe   (single-file Windows executable)
"""

import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPTS_DIR.parent

def main() -> None:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("[build] Installing PyInstaller...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "pyinstaller", "-q"],
            check=True,
        )

    cli_path = SCRIPTS_DIR / "purvex_cli.py"
    if not cli_path.is_file():
        print("[build] ERROR: purvex_cli.py not found.")
        sys.exit(1)

    print("[build] Building purvex.exe...")
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--onefile",
            "--name", "purvex",
            "--distpath", str(SCRIPTS_DIR),
            "--workpath", str(ROOT_DIR / "build" / "pyinstaller"),
            "--specpath", str(ROOT_DIR / "build"),
            "--clean",
            "--noconfirm",
            "--console",
            str(cli_path),
        ],
        check=True,
        cwd=str(ROOT_DIR),
    )

    exe = SCRIPTS_DIR / "purvex.exe"
    if exe.is_file():
        size_mb = exe.stat().st_size / (1024 * 1024)
        print(f"[build] Done: {exe}  ({size_mb:.1f} MB)")
        print(f"[build] Run:  scripts\\purvex.exe --help")
    else:
        print("[build] ERROR: purvex.exe was not created.")
        sys.exit(1)


if __name__ == "__main__":
    main()
