# PurveX Agent Registration Scripts

Simple scripts to register a sandbox or lab computer as a PurveX test runner. These scripts can be easily copied and pasted onto any machine.

## Quick Start

### Python (Cross-platform)

```bash
# Install dependencies
pip install requests

# Run registration
python3 register_agent.py --api-url http://your-purvex-server:8001 --token YOUR_TOKEN --env lab
```

### Bash (Linux/Unix)

```bash
# Make executable and run
chmod +x register_agent.sh
./register_agent.sh --api-url http://your-purvex-server:8001 --token YOUR_TOKEN --env lab
```

### PowerShell (Windows)

```powershell
# Run registration
.\register_agent.ps1 -ApiUrl "http://your-purvex-server:8001" -Token "YOUR_TOKEN" -Env "lab"
```

## Features

- ✅ **Auto-detection**: Automatically detects hostname, IP address, and OS type
- ✅ **Simple**: Just copy, paste, and run
- ✅ **Flexible**: Supports command-line arguments or environment variables
- ✅ **One-time friendly**: Prompts for a registration token if not provided
- ✅ **Cross-platform**: Python (all platforms), Bash (Linux/Unix), PowerShell (Windows)

## Usage

### Using Command-Line Arguments

**Python:**
```bash
python3 register_agent.py \
  --api-url http://127.0.0.1:8001 \
  --admin-username admin \
  --admin-password admin \
  --env lab \
  --hostname my-lab-machine \
  --port 22 \
  --username purvex
```

**Bash:**
```bash
./register_agent.sh \
  --api-url http://127.0.0.1:8001 \
  --admin-username admin \
  --admin-password admin \
  --env lab \
  --hostname my-lab-machine \
  --port 22 \
  --username purvex
```

**PowerShell:**
```powershell
.\register_agent.ps1 `
  -ApiUrl "http://127.0.0.1:8001" `
  -AdminUsername "admin" `
  -AdminPassword "admin" `
  -Env "lab" `
  -Hostname "my-lab-machine" `
  -Port 22 `
  -Username "purvex"
```

### Using Environment Variables

**Python/Bash:**
```bash
export PURVEX_API_URL=http://127.0.0.1:8001
export PURVEX_API_TOKEN=YOUR_TOKEN
export PURVEX_ENV=lab
export PURVEX_HOSTNAME=my-lab-machine
export PURVEX_PORT=22
export PURVEX_USERNAME=purvex

python3 register_agent.py
# or
./register_agent.sh
```

**PowerShell:**
```powershell
$env:PURVEX_API_URL = "http://127.0.0.1:8001"
$env:PURVEX_API_TOKEN = "YOUR_TOKEN"
$env:PURVEX_ENV = "lab"
$env:PURVEX_HOSTNAME = "my-lab-machine"
$env:PURVEX_PORT = "22"
$env:PURVEX_USERNAME = "purvex"

.\register_agent.ps1
```

## Parameters

| Parameter | Environment Variable | Description | Default |
|-----------|---------------------|-------------|---------|
| `--api-url` / `-ApiUrl` | `PURVEX_API_URL` | PurveX API base URL | `http://127.0.0.1:8001` |
| `--token` / `-Token` | `PURVEX_API_TOKEN` | Registration token (required) | None |
| `--admin-password` / `-AdminPassword` | `PURVEX_ADMIN_PASSWORD` | Admin password to mint a registration token | None |
| `--env` / `-Env` | `PURVEX_ENV` | Environment name (lab, dev, prod) | `lab` |
| `--hostname` / `-Hostname` | `PURVEX_HOSTNAME` | Custom hostname | Auto-detected |
| `--port` / `-Port` | `PURVEX_PORT` | SSH port | `22` |
| `--username` / `-Username` | `PURVEX_USERNAME` | SSH username | Current user |

## Getting an API Token

You need a one-time registration token. Tokens are single-use and short-lived (by default 60 minutes). You can obtain one from:

1. The PurveX web interface (Settings → API Tokens)
2. Your PurveX administrator
3. The backend API directly (if you have access)

## What Gets Registered

When you run the script, it registers the machine with:

- **Hostname**: Auto-detected or custom
- **IP Address**: Local IP address (for reference)
- **OS Type**: Windows, Linux, or macOS
- **Environment**: lab, dev, or prod
- **SSH Configuration**: Port, username, and auth method
- **Test Limits**: Max concurrent tests, heartbeat interval, etc.

## Verification

After registration, you can verify the agent was registered by:

1. Checking the PurveX web interface: Settings → Test Runners
2. Using the API: `GET /api/settings/environment-runners`
3. The script will display the Runner ID upon successful registration

## Token Rotation

Admins can rotate a runner token to force re-registration:

```
POST /settings/environment-runners/{runner_id}/rotate-token
```

The response includes a new one-time token and expiration timestamp.

## Troubleshooting

### "Access denied" (403)
- Check that your API token is correct
- Ensure your user has admin privileges
- Verify the token hasn't expired

### "Cannot connect to server"
- Verify the PurveX server is running
- Check the API URL is correct
- Ensure network connectivity to the server
- Check firewall rules

### "Runner already exists" (409)
- A runner with this hostname is already registered
- You may need to update the existing runner instead
- Or use a different hostname

### "requests library not found" (Python)
```bash
pip install requests
```

### "curl not found" (Bash)
```bash
# Debian/Ubuntu
apt-get install curl

# RHEL/CentOS
yum install curl
```

## Security Notes

- ⚠️ **Never commit API tokens to version control**
- ⚠️ **Use environment variables or secure credential storage**
- ⚠️ **Tokens should have appropriate expiration times**
- ⚠️ **Only run on trusted machines in your lab/sandbox environment**

## Next Steps

After registration:

1. The machine will appear in PurveX as a test runner
2. You can configure SSH keys for authentication
3. The runner will be available for test execution
4. Monitor the runner status in the PurveX dashboard
