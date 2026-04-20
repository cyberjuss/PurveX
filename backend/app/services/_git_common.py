"""Shared git primitives used by ``git_sync`` (inbound) and ``git_writeback``
(outbound).

Design
------
The sync path was written first and inlined its own git plumbing. The
audit-mirror path needs the same shell-out discipline (bounded timeout,
argv list never a shell, token scrubbing, token injected via
``x-access-token`` URL idiom so it's invisible to logs). This module
factors those helpers out so both sides converge on a single, audited
command surface.

All helpers are provider-agnostic at this level — they take a repo URL,
an auth type string, and an optional encrypted secret. The sync / mirror
callers adapt their ORM rows into those primitives.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import quote, urlparse, urlunparse

from ..utils.encryption import decrypt_value

logger = logging.getLogger("purvex.services.git")

# Git CLI timeout (seconds). Bounded so a hung fetch/push can't wedge the
# sync endpoint forever. 120s is plenty for any reasonable detection repo.
_GIT_TIMEOUT_SEC = 120


class GitCommandError(RuntimeError):
    """Raised for any expected git failure (network, auth, push rejected, …).

    Error messages passed to this exception have already been scrubbed of
    credential material via ``scrub_auth``.
    """


def build_auth_url(
    *,
    repo_url: str,
    auth_type: str,
    auth_secret_encrypted: Optional[str],
) -> str:
    """Inject a decrypted PAT into the HTTPS URL if ``auth_type == 'token'``.

    Token is URL-encoded (``quote(..., safe="")``) to survive characters
    like ``@`` or ``:``. We use ``x-access-token`` as the username — the
    cross-provider idiom that GitHub/GitLab/Bitbucket all accept.

    Token flows through argv (the clone target), never as an extra
    credential-helper roundtrip, and is scrubbed from any logged stderr.
    """
    if auth_type != "token" or not auth_secret_encrypted:
        return repo_url
    token = decrypt_value(auth_secret_encrypted)
    if not token:
        return repo_url
    parsed = urlparse(repo_url)
    netloc = f"x-access-token:{quote(token, safe='')}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


def scrub_auth(
    text: str,
    *,
    auth_type: str,
    auth_secret_encrypted: Optional[str],
) -> str:
    """Strip any accidental token leakage from git stderr before logging."""
    if auth_type != "token" or not auth_secret_encrypted:
        return text
    token = decrypt_value(auth_secret_encrypted)
    if not token:
        return text
    return text.replace(token, "***")


async def run_git(
    args: List[str],
    cwd: Optional[Path] = None,
    *,
    env_overrides: Optional[dict] = None,
) -> Tuple[int, str, str]:
    """Run ``git <args>`` with a hard timeout. Returns (rc, stdout, stderr).

    Environment:

    * ``GIT_TERMINAL_PROMPT=0`` — never prompt interactively (a wrong PAT
      errors fast instead of hanging the event loop).
    * ``GIT_ASKPASS=/bin/true`` (or ``echo`` on Windows) — belt & braces
      against any subcommand that still tries to ask for a password.
    """
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "/bin/true" if os.name != "nt" else "echo",
    }
    if env_overrides:
        env.update(env_overrides)

    def _run() -> Tuple[int, str, str]:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            env=env,
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT_SEC,
            check=False,
        )
        return proc.returncode, proc.stdout, proc.stderr

    try:
        return await asyncio.to_thread(_run)
    except FileNotFoundError as exc:
        raise GitCommandError(
            "git binary not found on the PATH. Install git and retry."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise GitCommandError(
            f"git command timed out after {_GIT_TIMEOUT_SEC}s"
        ) from exc


async def clone_shallow(
    *,
    dest: Path,
    repo_url: str,
    branch: str,
    auth_type: str,
    auth_secret_encrypted: Optional[str],
) -> Optional[str]:
    """Shallow-clone a single branch into ``dest``. Returns HEAD commit SHA.

    ``depth=1`` keeps clones small on huge audit repos. If you need more
    history for a specific operation, use ``run_git(['fetch', '--deepen', N])``
    on the clone directory.
    """
    url = build_auth_url(
        repo_url=repo_url,
        auth_type=auth_type,
        auth_secret_encrypted=auth_secret_encrypted,
    )
    rc, _, err = await run_git(
        [
            # Force LF-only line endings on checkout. Without this, Windows
            # hosts get CRLF in the working tree, which breaks byte-exact
            # comparison when we try to detect no-op mirror writes (and
            # also corrupts commit-deduplication across platforms).
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.eol=lf",
            "clone",
            "--depth",
            "1",
            "--branch",
            branch,
            "--single-branch",
            url,
            str(dest),
        ]
    )
    if rc != 0:
        raise GitCommandError(
            "git clone failed: "
            + (
                scrub_auth(
                    err.strip(),
                    auth_type=auth_type,
                    auth_secret_encrypted=auth_secret_encrypted,
                )
                or "unknown error"
            )
        )
    rc, out, err = await run_git(["rev-parse", "HEAD"], cwd=dest)
    if rc != 0:
        raise GitCommandError(
            "git rev-parse failed: "
            + scrub_auth(
                err.strip(),
                auth_type=auth_type,
                auth_secret_encrypted=auth_secret_encrypted,
            )
        )
    return out.strip() or None


async def push_branch(
    *,
    cwd: Path,
    repo_url: str,
    branch: str,
    auth_type: str,
    auth_secret_encrypted: Optional[str],
) -> None:
    """Push ``cwd``'s current HEAD to ``branch`` on the remote.

    Uses an explicit URL on the command line (instead of the ``origin``
    remote that ``clone`` configured) so the injected token never touches
    ``.git/config`` on disk.
    """
    url = build_auth_url(
        repo_url=repo_url,
        auth_type=auth_type,
        auth_secret_encrypted=auth_secret_encrypted,
    )
    rc, _, err = await run_git(
        ["push", url, f"HEAD:{branch}"],
        cwd=cwd,
    )
    if rc != 0:
        raise GitCommandError(
            "git push failed: "
            + (
                scrub_auth(
                    err.strip(),
                    auth_type=auth_type,
                    auth_secret_encrypted=auth_secret_encrypted,
                )
                or "unknown error"
            )
        )
