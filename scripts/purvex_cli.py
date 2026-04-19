"""
purvex — Unified PurveX launcher (compiles to purvex.exe via PyInstaller)

Usage:
    purvex --start          Start backend + frontend
    purvex --setup          Install all dependencies
    purvex --rebuild        Rebuild and restart everything
    purvex --status         Show service status
    purvex --help           Show this help
"""

import os
import platform
import signal
import subprocess
import sys
import time
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────

if getattr(sys, "frozen", False):
    SCRIPT_DIR = Path(sys.executable).resolve().parent
else:
    SCRIPT_DIR = Path(__file__).resolve().parent

ROOT_DIR = SCRIPT_DIR.parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"

BACKEND_PORT = os.environ.get("BACKEND_PORT", "8001")
FRONTEND_PORT = os.environ.get("FRONTEND_PORT", "1120")
IS_WINDOWS = platform.system() == "Windows"

# ── Output helpers ───────────────────────────────────────────────────────────

def info(msg: str) -> None:
    print(f"\033[1;32m[purvex]\033[0m {msg}")

def warn(msg: str) -> None:
    print(f"\033[1;33m[purvex]\033[0m {msg}")

def fail(msg: str) -> None:
    print(f"\033[1;31m[purvex]\033[0m {msg}")
    sys.exit(1)

# ── Prereqs ──────────────────────────────────────────────────────────────────

def find_python() -> str:
    candidates = ["python3", "python"] if not IS_WINDOWS else ["python", "python3"]
    for cmd in candidates:
        try:
            result = subprocess.run(
                [cmd, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                ver = result.stdout.strip()
                major, minor = ver.split(".")
                if int(major) >= 3 and int(minor) >= 11:
                    return cmd
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    fail("Python 3.11+ is required but not found. Install it and retry.")
    return ""


def find_node() -> str:
    try:
        result = subprocess.run(["node", "-v"], capture_output=True, text=True, timeout=10)
        ver = result.stdout.strip().lstrip("v")
        major = int(ver.split(".")[0])
        if major < 20:
            fail(f"Node.js 20+ required. Found: {ver}")
        return ver
    except (FileNotFoundError, subprocess.TimeoutExpired):
        fail("Node.js 20+ and npm are required. Install them and retry.")
        return ""


def check_npm() -> None:
    try:
        subprocess.run(["npm", "-v"], capture_output=True, text=True, timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        fail("npm is required but not found.")


def check_prereqs() -> str:
    python_cmd = find_python()
    result = subprocess.run([python_cmd, "--version"], capture_output=True, text=True)
    info(f"Python: {result.stdout.strip()}")
    node_ver = find_node()
    check_npm()
    info(f"Node: v{node_ver}")
    return python_cmd

# ── .env loader ──────────────────────────────────────────────────────────────

def load_env() -> None:
    env_file = ROOT_DIR / ".env"
    if env_file.is_file():
        info("Loading .env")
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value

    os.environ.setdefault("CORS_ORIGINS", f'["http://localhost:{FRONTEND_PORT}","http://127.0.0.1:{FRONTEND_PORT}"]')
    os.environ.setdefault("ALLOW_HTTP_LOCALHOST", "1")
    os.environ.setdefault("ALLOW_RATE_LIMIT_LOCALHOST", "1")

# ── Venv helpers ─────────────────────────────────────────────────────────────

def venv_python() -> str:
    if IS_WINDOWS:
        return str(BACKEND_DIR / "venv" / "Scripts" / "python.exe")
    return str(BACKEND_DIR / "venv" / "bin" / "python")


def venv_bin(name: str) -> str:
    if IS_WINDOWS:
        return str(BACKEND_DIR / "venv" / "Scripts" / name)
    return str(BACKEND_DIR / "venv" / "bin" / name)


def activate_env() -> dict:
    """Return an env dict with the venv prepended to PATH."""
    env = os.environ.copy()
    if IS_WINDOWS:
        venv_path = str(BACKEND_DIR / "venv" / "Scripts")
    else:
        venv_path = str(BACKEND_DIR / "venv" / "bin")
    env["PATH"] = venv_path + os.pathsep + env.get("PATH", "")
    env["VIRTUAL_ENV"] = str(BACKEND_DIR / "venv")
    env["PYTHONPATH"] = str(BACKEND_DIR)
    return env

# ── Setup ────────────────────────────────────────────────────────────────────

def setup_backend(python_cmd: str) -> None:
    info("Setting up backend...")
    venv_dir = BACKEND_DIR / "venv"
    if not venv_dir.is_dir():
        info("Creating Python virtual environment...")
        subprocess.run([python_cmd, "-m", "venv", str(venv_dir)], check=True)

    env = activate_env()
    py = venv_python()

    info("Installing Python dependencies...")
    subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip", "-q"], env=env, check=True)

    req_root = ROOT_DIR / "requirements.txt"
    if req_root.is_file():
        subprocess.run([py, "-m", "pip", "install", "-r", str(req_root), "-q"], env=env, check=True)

    req_dev = BACKEND_DIR / "requirements-dev.txt"
    if req_dev.is_file():
        subprocess.run([py, "-m", "pip", "install", "-r", str(req_dev), "-q"], env=env, check=True)

    info("Backend dependencies installed.")


def setup_frontend() -> None:
    info("Setting up frontend...")
    subprocess.run(["npm", "install"], cwd=str(FRONTEND_DIR), check=True, shell=IS_WINDOWS)
    info("Frontend dependencies installed.")


def cmd_setup() -> None:
    python_cmd = check_prereqs()
    load_env()
    setup_backend(python_cmd)
    setup_frontend()
    print()
    info("Setup complete. Run: purvex --start")

# ── Start ────────────────────────────────────────────────────────────────────

_procs: list[subprocess.Popen] = []


def cleanup(*_args) -> None:
    for proc in _procs:
        if proc.poll() is None:
            info(f"Stopping PID {proc.pid}...")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
    sys.exit(0)


def wait_for_db(timeout_secs: int = 30) -> bool:
    db_path = BACKEND_DIR / "purvex.db"
    for _ in range(timeout_secs * 2):
        if db_path.is_file():
            return True
        time.sleep(0.5)
    return False


def bootstrap_admin() -> None:
    marker = ROOT_DIR / ".purvex_admin_bootstrapped"
    if marker.is_file():
        return

    if not wait_for_db():
        warn("Database not ready; skipping admin bootstrap.")
        return

    info("First-run admin setup...")
    env = activate_env()
    result = subprocess.run(
        [venv_python(), str(BACKEND_DIR / "scripts" / "create_admin.py"), "--only-if-missing"],
        env=env, cwd=str(BACKEND_DIR),
    )
    if result.returncode == 0:
        marker.touch()
        info("Admin created. Use those credentials to sign in.")
    else:
        warn("Admin bootstrap failed; will retry next start.")


def start_backend() -> subprocess.Popen:
    env = activate_env()
    info(f"Starting backend on http://127.0.0.1:{BACKEND_PORT}")
    proc = subprocess.Popen(
        [venv_bin("uvicorn"), "app.main:app", "--host", "0.0.0.0", "--port", BACKEND_PORT, "--reload"],
        cwd=str(BACKEND_DIR), env=env,
    )
    _procs.append(proc)
    return proc


def start_frontend() -> subprocess.Popen:
    if not (FRONTEND_DIR / "node_modules").is_dir():
        fail("Frontend dependencies missing. Run: purvex --setup")

    info("Building frontend...")
    subprocess.run(["npm", "run", "build"], cwd=str(FRONTEND_DIR), check=True, shell=IS_WINDOWS)

    env = os.environ.copy()
    env["PORT"] = FRONTEND_PORT

    info(f"Starting frontend on http://127.0.0.1:{FRONTEND_PORT}")
    proc = subprocess.Popen(
        ["npm", "run", "start"], cwd=str(FRONTEND_DIR), env=env, shell=IS_WINDOWS,
    )
    _procs.append(proc)
    return proc


def cmd_start() -> None:
    check_prereqs()
    load_env()

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)
    if IS_WINDOWS:
        signal.signal(signal.SIGBREAK, cleanup)

    backend_proc = start_backend()
    bootstrap_admin()
    frontend_proc = start_frontend()

    print()
    info("PurveX is running:")
    info(f"  Backend  → http://127.0.0.1:{BACKEND_PORT}")
    info(f"  Frontend → http://127.0.0.1:{FRONTEND_PORT}")
    info("  Press Ctrl+C to stop.")
    print()

    try:
        while True:
            if backend_proc.poll() is not None:
                warn(f"Backend exited with code {backend_proc.returncode}")
                cleanup()
            if frontend_proc.poll() is not None:
                warn(f"Frontend exited with code {frontend_proc.returncode}")
                cleanup()
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()

# ── Rebuild ──────────────────────────────────────────────────────────────────

def cmd_rebuild() -> None:
    info("Rebuilding PurveX...")
    python_cmd = check_prereqs()
    load_env()

    venv_dir = BACKEND_DIR / "venv"
    if venv_dir.is_dir():
        env = activate_env()
        py = venv_python()
        info("Reinstalling backend dependencies...")
        subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip", "-q"], env=env, check=True)
        req_root = ROOT_DIR / "requirements.txt"
        if req_root.is_file():
            subprocess.run([py, "-m", "pip", "install", "-r", str(req_root), "-q"], env=env, check=True)
        req_dev = BACKEND_DIR / "requirements-dev.txt"
        if req_dev.is_file():
            subprocess.run([py, "-m", "pip", "install", "-r", str(req_dev), "-q"], env=env, check=True)
    else:
        setup_backend(python_cmd)

    next_dir = FRONTEND_DIR / ".next"
    if next_dir.is_dir():
        info("Clearing .next cache...")
        import shutil
        shutil.rmtree(next_dir, ignore_errors=True)

    info("Reinstalling frontend dependencies...")
    subprocess.run(["npm", "install"], cwd=str(FRONTEND_DIR), check=True, shell=IS_WINDOWS)
    info("Rebuilding frontend...")
    subprocess.run(["npm", "run", "build"], cwd=str(FRONTEND_DIR), check=True, shell=IS_WINDOWS)

    print()
    info("Rebuild complete. Run: purvex --start")

# ── Status ───────────────────────────────────────────────────────────────────

def cmd_status() -> None:
    load_env()
    print()
    info("PurveX status check")
    print()

    # Python
    try:
        py = find_python()
        r = subprocess.run([py, "--version"], capture_output=True, text=True)
        print(f"  Python         {r.stdout.strip()}")
    except SystemExit:
        print("  Python         NOT FOUND")

    # Node
    try:
        r = subprocess.run(["node", "-v"], capture_output=True, text=True, timeout=5)
        print(f"  Node           {r.stdout.strip()}")
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("  Node           NOT FOUND")

    # Venv
    venv_ok = (BACKEND_DIR / "venv").is_dir()
    print(f"  Backend venv   {'OK' if venv_ok else 'MISSING — run purvex --setup'}")

    # node_modules
    nm_ok = (FRONTEND_DIR / "node_modules").is_dir()
    print(f"  node_modules   {'OK' if nm_ok else 'MISSING — run purvex --setup'}")

    # .next build
    next_ok = (FRONTEND_DIR / ".next").is_dir()
    print(f"  Frontend build {'OK' if next_ok else 'NOT BUILT — run purvex --start or --rebuild'}")

    # Database
    db_ok = (BACKEND_DIR / "purvex.db").is_file()
    print(f"  Database       {'OK' if db_ok else 'NOT CREATED YET (created on first start)'}")

    # Admin
    admin_ok = (ROOT_DIR / ".purvex_admin_bootstrapped").is_file()
    print(f"  Admin user     {'Bootstrapped' if admin_ok else 'Not yet (will prompt on first start)'}")

    # .env
    env_ok = (ROOT_DIR / ".env").is_file()
    print(f"  .env file      {'Found' if env_ok else 'Not found (using defaults)'}")

    # Ports
    print(f"  Backend port   {BACKEND_PORT}")
    print(f"  Frontend port  {FRONTEND_PORT}")
    print()

# ── Help ─────────────────────────────────────────────────────────────────────

HELP = """
PurveX — Detection Validation Platform

Usage: purvex <command>

Commands:
  --start     Start the backend (FastAPI) and frontend (Next.js)
  --setup     Install Python venv, pip deps, and npm deps
  --rebuild   Reinstall deps, clear caches, rebuild frontend
  --status    Show environment and dependency status
  --help      Show this help

Environment variables:
  BACKEND_PORT   Backend port   (default: 8001)
  FRONTEND_PORT  Frontend port  (default: 1120)

Examples:
  purvex --setup                         First-time setup
  purvex --start                         Daily development
  set FRONTEND_PORT=3000 && purvex --start
""".strip()

# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print(HELP)
        sys.exit(1)

    cmd = sys.argv[1].lower().lstrip("-")
    commands = {
        "start": cmd_start,
        "setup": cmd_setup,
        "rebuild": cmd_rebuild,
        "status": cmd_status,
        "help": lambda: print(HELP),
        "h": lambda: print(HELP),
    }

    handler = commands.get(cmd)
    if handler is None:
        fail(f"Unknown command: {sys.argv[1]}")
        print(HELP)
        sys.exit(1)

    handler()


if __name__ == "__main__":
    main()
