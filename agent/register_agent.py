#!/usr/bin/env python3
"""
PurveX Agent Registration Script

This script can be copied and pasted onto any sandbox or lab computer.
It will automatically detect the machine's hostname/IP and register itself
with the PurveX system as a test runner.

Usage:
    python3 register_agent.py --api-url http://your-purvex-server:8000 --token YOUR_API_TOKEN --env lab

Or set environment variables:
    export PURVEX_API_URL=http://your-purvex-server:8000
    export PURVEX_API_TOKEN=YOUR_API_TOKEN
    export PURVEX_ENV=lab
    python3 register_agent.py
"""

import os
import sys
import socket
import argparse
import json
import platform
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: 'requests' library not found. Install it with: pip install requests")
    sys.exit(1)


def get_hostname() -> str:
    """Get the machine's hostname."""
    return socket.gethostname()


def get_local_ip() -> str:
    """Get the machine's local IP address."""
    try:
        # Connect to a remote address to determine local IP
        # This doesn't actually send data, just determines the route
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        try:
            # Try to connect to a non-routable address
            s.connect(('10.254.254.254', 1))
            ip = s.getsockname()[0]
        except Exception:
            ip = '127.0.0.1'
        finally:
            s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def get_os_type() -> str:
    """Detect the operating system type."""
    system = platform.system().lower()
    if system == 'windows':
        return 'windows'
    elif system == 'linux':
        return 'linux'
    elif system == 'darwin':
        return 'macos'
    else:
        return 'unknown'


def get_registration_token(
    api_url: str,
    admin_token: Optional[str] = None,
    admin_email: Optional[str] = None,
    admin_password: Optional[str] = None,
) -> Optional[str]:
    if not admin_token and admin_email and admin_password:
        login_url = f"{api_url.rstrip('/')}/auth/login"
        resp = requests.post(
            login_url,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"username": admin_email, "password": admin_password},
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"ERROR: Failed to authenticate admin (HTTP {resp.status_code}).")
            print(resp.text)
            return None
        admin_token = resp.json().get("access_token")

    if not admin_token:
        return None

    token_url = f"{api_url.rstrip('/')}/settings/agent-registration-token"
    resp = requests.post(
        token_url,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"ERROR: Failed to mint registration token (HTTP {resp.status_code}).")
        print(resp.text)
        return None
    return resp.json().get("token")


def register_agent(
    api_url: str,
    api_token: str,
    environment: str,
    hostname: Optional[str] = None,
    port: int = 22,
    username: Optional[str] = None
) -> dict:
    """
    Register this agent with the PurveX backend.
    
    Args:
        api_url: Base URL of the PurveX API (e.g., http://localhost:8000)
        api_token: API token for authentication
        environment: Environment name (e.g., 'lab', 'dev', 'prod')
        hostname: Optional hostname (auto-detected if not provided)
        port: SSH port (default: 22)
        username: Optional username (defaults to current user)
    
    Returns:
        Registration response from the API
    """
    if not hostname:
        hostname = get_hostname()
    
    if not username:
        username = os.getenv('USER') or os.getenv('USERNAME') or 'purvex'
    
    # Prepare registration data
    registration_data = {
        "environment_name": environment,
        "runner_type": "SSH",
        "hostname": hostname,
        "port": port,
        "username": username,
        "auth_method": "key",
        "allowed_test_types": '["Atomic only"]',
        "max_concurrent_tests": 1,
        "heartbeat_interval_seconds": 60,
        "alert_offline_minutes": 5
    }
    
    # Make API request
    url = f"{api_url.rstrip('/')}/api/settings/environment-runners"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    
    print(f"Connecting to PurveX at: {api_url}")
    print(f"Registering agent:")
    print(f"  Hostname: {hostname}")
    print(f"  IP Address: {get_local_ip()}")
    print(f"  OS Type: {get_os_type()}")
    print(f"  Environment: {environment}")
    print(f"  Port: {port}")
    print(f"  Username: {username}")
    print()
    
    try:
        response = requests.post(
            url,
            json=registration_data,
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        
        result = response.json()
        print("✅ Successfully registered with PurveX!")
        print(f"   Runner ID: {result.get('id')}")
        print(f"   Environment: {result.get('environment_name')}")
        print(f"   Hostname: {result.get('hostname')}")
        return result
        
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 403:
            print("❌ ERROR: Access denied. Check your API token and ensure you have admin privileges.")
        elif e.response.status_code == 409:
            print("⚠️  WARNING: A runner with this hostname already exists.")
            print("   You may need to update the existing runner instead.")
        else:
            print(f"❌ ERROR: HTTP {e.response.status_code}")
            try:
                error_detail = e.response.json()
                print(f"   Details: {error_detail.get('detail', 'Unknown error')}")
            except:
                print(f"   Response: {e.response.text}")
        sys.exit(1)
        
    except requests.exceptions.ConnectionError:
        print(f"❌ ERROR: Cannot connect to {api_url}")
        print("   Please check:")
        print("   1. The PurveX server is running")
        print("   2. The API URL is correct")
        print("   3. Network connectivity to the server")
        sys.exit(1)
        
    except requests.exceptions.Timeout:
        print("❌ ERROR: Connection timeout. The server took too long to respond.")
        sys.exit(1)
        
    except Exception as e:
        print(f"❌ ERROR: {type(e).__name__}: {str(e)}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Register this machine as a PurveX test runner agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Using command-line arguments:
  python3 register_agent.py --api-url http://localhost:8000 --token YOUR_TOKEN --env lab
  
  # Mint a one-time registration token automatically:
  python3 register_agent.py --api-url http://localhost:8000 --admin-email admin --admin-password admin --env lab
  
  # Using environment variables:
  export PURVEX_API_URL=http://localhost:8000
  export PURVEX_API_TOKEN=YOUR_TOKEN
  export PURVEX_ENV=lab
  python3 register_agent.py
  
  # With custom hostname and port:
  python3 register_agent.py --api-url http://localhost:8000 --token YOUR_TOKEN --env lab --hostname my-lab-machine --port 2222
        """
    )
    
    parser.add_argument(
        '--api-url',
        default=os.getenv('PURVEX_API_URL', 'http://localhost:8000'),
        help='PurveX API base URL (default: http://localhost:8000 or PURVEX_API_URL env var)'
    )
    
    parser.add_argument(
        '--token',
        default=os.getenv('PURVEX_API_TOKEN'),
        help='API authentication token (or set PURVEX_API_TOKEN env var)'
    )

    parser.add_argument(
        '--admin-token',
        default=os.getenv('PURVEX_ADMIN_TOKEN'),
        help='Admin JWT to mint a registration token (or set PURVEX_ADMIN_TOKEN env var)'
    )

    parser.add_argument(
        '--admin-email',
        default=os.getenv('PURVEX_ADMIN_EMAIL'),
        help='Admin email for login to mint a registration token (or set PURVEX_ADMIN_EMAIL env var)'
    )

    parser.add_argument(
        '--admin-password',
        default=os.getenv('PURVEX_ADMIN_PASSWORD'),
        help='Admin password for login to mint a registration token (or set PURVEX_ADMIN_PASSWORD env var)'
    )
    
    parser.add_argument(
        '--env',
        default=os.getenv('PURVEX_ENV', 'lab'),
        help='Environment name: lab, dev, or prod (default: lab or PURVEX_ENV env var)'
    )
    
    parser.add_argument(
        '--hostname',
        default=None,
        help='Custom hostname (auto-detected if not provided)'
    )
    
    parser.add_argument(
        '--port',
        type=int,
        default=22,
        help='SSH port (default: 22)'
    )
    
    parser.add_argument(
        '--username',
        default=None,
        help='SSH username (defaults to current user)'
    )
    
    args = parser.parse_args()
    
    api_token = args.token
    if not api_token:
        api_token = get_registration_token(
            args.api_url,
            admin_token=args.admin_token,
            admin_email=args.admin_email,
            admin_password=args.admin_password,
        )

    # Validate required arguments
    if not api_token:
        print("❌ ERROR: API token is required.")
        print("   Provide it via --token or set admin creds to mint one.")
        sys.exit(1)
    
    if not args.api_url:
        print("❌ ERROR: API URL is required.")
        print("   Provide it via --api-url argument or PURVEX_API_URL environment variable")
        sys.exit(1)
    
    # Register the agent
    register_agent(
        api_url=args.api_url,
        api_token=api_token,
        environment=args.env,
        hostname=args.hostname,
        port=args.port,
        username=args.username
    )


if __name__ == '__main__':
    main()
