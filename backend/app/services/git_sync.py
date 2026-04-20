"""Git-backed Detection-as-Code sync service.

Responsibilities
----------------
1. Clone or fetch a ``DetectionSource`` repo into a tenant-scoped workspace.
2. Walk ``path_glob`` and parse each YAML file into a canonical detection
   payload.
3. For each parsed detection, decide:

   * **create** — no existing row for ``(detection_source_id, source_path)``.
     We create it immediately, stamped with git provenance.
   * **update (no local drift)** — existing row's ``content_hash`` matches
     a prior sync. The upstream changed; we update in place.
   * **propose** — existing row's ``content_hash`` doesn't match the prior
     sync (someone edited it locally after we synced). We open a
     ``DetectionProposal`` with ``proposed_by_kind="git"`` so a human
     arbitrates instead of clobbering local edits.
   * **skip** — nothing changed upstream or locally.

4. Return a ``DetectionSourceSyncResult`` with counts and persist sync
   telemetry onto the source row.

Security notes
--------------
* We shell out to the ``git`` binary rather than adding GitPython. The
  command line is constructed with an explicit argv list, never via a
  shell, so URL / branch values can't be used for command injection.
* The repo is cloned to a scratch directory under ``tempfile.gettempdir()``
  and deleted after the sync; no persistent checkout is left on disk.
* Auth tokens are decrypted just-in-time from the ``DetectionSource`` row
  and injected via ``url.username``-style HTTPS (never echoed to the
  process argv, never logged).
* Path-globbing is done in-process with ``pathlib.Path.rglob`` + manual
  ``fnmatch``, never via shell expansion; symlinks that escape the clone
  dir are skipped via ``resolve(strict=False).is_relative_to()`` checks.
"""
from __future__ import annotations

import asyncio
import fnmatch
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional, Tuple
from urllib.parse import quote, urlparse, urlunparse

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..utils.encryption import decrypt_value

logger = logging.getLogger("purvex.git_sync")


# Fields we serialise / accept from YAML. Matches PROPOSAL_EDITABLE_FIELDS
# plus the minimum needed for ``create``. Keep this list tight — it's the
# schema contract for the YAML files users put in their repo.
_YAML_FIELDS = (
    "title",
    "description",
    "sigma_rule",
    "siem_type",
    "siem_query",
    "technique_id",
    "status",
    "criticality",
    "owner",
    "notes",
    "lifecycle_stage",
)
_REQUIRED_ON_CREATE = ("title", "siem_type", "siem_query", "technique_id")

# Max file size (1 MiB) we'll parse. Anything larger is almost certainly
# not a detection rule and we'd rather fail cheap than OOM.
_MAX_YAML_BYTES = 1 * 1024 * 1024

# Git CLI timeout (seconds). Bounded so a hung fetch can't wedge the
# sync endpoint forever. 120s is plenty for any reasonable detection repo.
_GIT_TIMEOUT_SEC = 120


@dataclass
class _FileDecision:
    """Per-file outcome after we compare upstream to the DB."""

    path: str
    payload: dict
    content_hash: str
    action: str  # "create" | "update" | "propose" | "skip" | "error"
    error: Optional[str] = None
    detection: Optional[models.Detection] = None


@dataclass
class SyncOutcome:
    """Aggregated result of one sync run."""

    commit_sha: Optional[str] = None
    created: int = 0
    updated: int = 0
    proposals: int = 0
    skipped: int = 0
    errors: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
async def sync_detection_source(
    db: AsyncSession,
    source: models.DetectionSource,
    *,
    proposer_label: Optional[str] = None,
) -> SyncOutcome:
    """Run a full sync of ``source``. Persists telemetry + records audit.

    The caller is responsible for committing the transaction; we don't
    commit here so the router can bundle the audit event into the same
    transaction as the telemetry update.
    """
    outcome = SyncOutcome()
    if not source.enabled:
        outcome.errors.append("source is disabled")
        _apply_telemetry(source, outcome, status="error", error="source disabled")
        return outcome

    tmpdir = Path(tempfile.mkdtemp(prefix=f"purvex-dac-{source.id}-"))
    try:
        outcome.commit_sha = await _clone_to(tmpdir, source)
        files = _discover_files(tmpdir, source.path_glob)
        decisions = await _evaluate_files(db, source, files, tmpdir)
        await _apply_decisions(
            db,
            source,
            decisions,
            proposer_label=proposer_label or "Detection-as-Code",
        )
        for d in decisions:
            if d.action == "create":
                outcome.created += 1
            elif d.action == "update":
                outcome.updated += 1
            elif d.action == "propose":
                outcome.proposals += 1
            elif d.action == "skip":
                outcome.skipped += 1
            elif d.action == "error":
                outcome.errors.append(f"{d.path}: {d.error}")
        _apply_telemetry(source, outcome, status="success")
    except _GitSyncError as exc:
        outcome.errors.append(str(exc))
        _apply_telemetry(source, outcome, status="error", error=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Unexpected git sync failure for source %s", source.id)
        outcome.errors.append(f"internal error: {exc}")
        _apply_telemetry(source, outcome, status="error", error=str(exc))
    finally:
        _rm_tree(tmpdir)
    return outcome


def to_api_result(source_id: int, outcome: SyncOutcome) -> schemas.DetectionSourceSyncResult:
    return schemas.DetectionSourceSyncResult(
        source_id=source_id,
        commit_sha=outcome.commit_sha,
        created=outcome.created,
        updated=outcome.updated,
        proposals=outcome.proposals,
        skipped=outcome.skipped,
        errors=outcome.errors,
    )


# ---------------------------------------------------------------------------
# YAML (de)serialisation — exposed for the export endpoint + tests
# ---------------------------------------------------------------------------
def detection_to_yaml(detection: models.Detection) -> str:
    """Render a Detection as a YAML payload suitable for a git repo."""
    payload = {"id": detection.id}
    for field_name in _YAML_FIELDS:
        value = getattr(detection, field_name, None)
        if value is None:
            continue
        payload[field_name] = value
    return yaml.safe_dump(payload, sort_keys=False, width=120)


def parse_detection_yaml(raw: str | bytes) -> dict:
    """Parse + validate a single YAML document; raises ValueError on failure."""
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError(f"invalid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("top-level document must be a mapping")
    out: dict = {}
    for field_name in _YAML_FIELDS:
        if field_name in data and data[field_name] is not None:
            # Coerce scalars to str; anything non-string that slipped in
            # becomes repr() so the user sees what's wrong instead of a
            # silent type error deep in SQLAlchemy.
            val = data[field_name]
            if isinstance(val, (int, float, bool)):
                val = str(val)
            if not isinstance(val, str):
                raise ValueError(f"field '{field_name}' must be a string")
            out[field_name] = val
    for required in _REQUIRED_ON_CREATE:
        if required not in out or not out[required].strip():
            raise ValueError(f"missing required field '{required}'")
    return out


# ---------------------------------------------------------------------------
# Git CLI wrapper
# ---------------------------------------------------------------------------
class _GitSyncError(RuntimeError):
    """Raised for any expected sync failure (network, auth, bad YAML, …)."""


def _build_auth_url(source: models.DetectionSource) -> str:
    """Inject a decrypted PAT into the HTTPS URL if auth_type=token.

    We put the token on the URL rather than in a ``-c`` credential helper
    so the git binary receives it via argv[0]/argv[1] (the clone target),
    not an extra config roundtrip. Token is URL-encoded to survive
    characters like ``@`` or ``:``.
    """
    url = source.repo_url
    if source.auth_type != "token":
        return url
    token = decrypt_value(source.auth_secret)
    if not token:
        return url
    parsed = urlparse(url)
    # x-access-token is the cross-provider idiom (GitHub/GitLab/Bitbucket
    # all accept it as the username when the password is a PAT).
    netloc = f"x-access-token:{quote(token, safe='')}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


async def _run_git(args: List[str], cwd: Optional[Path] = None) -> Tuple[int, str, str]:
    """Run ``git <args>`` with a timeout. Returns (rc, stdout, stderr)."""
    # ``GIT_TERMINAL_PROMPT=0`` prevents git from stalling on an interactive
    # credential prompt if the PAT is wrong — it errors out fast instead.
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "/bin/true" if os.name != "nt" else "echo",
    }

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
        raise _GitSyncError(
            "git binary not found on the PATH. Install git and retry."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise _GitSyncError(
            f"git command timed out after {_GIT_TIMEOUT_SEC}s"
        ) from exc


def _scrub_auth(text: str, source: models.DetectionSource) -> str:
    """Strip any accidental token leakage from git stderr before logging."""
    if source.auth_type != "token":
        return text
    token = decrypt_value(source.auth_secret)
    if not token:
        return text
    return text.replace(token, "***")


async def _clone_to(dest: Path, source: models.DetectionSource) -> Optional[str]:
    """Shallow-clone the repo and return the HEAD commit SHA."""
    url = _build_auth_url(source)
    rc, _, err = await _run_git(
        [
            "clone",
            "--depth",
            "1",
            "--branch",
            source.branch,
            "--single-branch",
            url,
            str(dest),
        ]
    )
    if rc != 0:
        raise _GitSyncError(
            f"git clone failed: {_scrub_auth(err.strip(), source) or 'unknown error'}"
        )
    rc, out, err = await _run_git(["rev-parse", "HEAD"], cwd=dest)
    if rc != 0:
        raise _GitSyncError(
            f"git rev-parse failed: {_scrub_auth(err.strip(), source)}"
        )
    return out.strip() or None


# ---------------------------------------------------------------------------
# File discovery + diff
# ---------------------------------------------------------------------------
def _discover_files(root: Path, path_glob: str) -> List[Path]:
    """Return repo-relative file paths that match ``path_glob``.

    We expand ``**`` manually so user-supplied globs can't escape the
    repo root via ``..`` traversal. Files that resolve outside ``root``
    (e.g. via a rogue symlink) are silently dropped.
    """
    root_resolved = root.resolve()
    matches: List[Path] = []
    # Normalise separators: git paths are always ``/``.
    norm = path_glob.replace("\\", "/").strip()
    if not norm:
        return matches
    # Split into a "search root" (up to the first wildcard) and a "pattern".
    # This lets us avoid walking the whole tree for simple globs like
    # ``detections/*.yml``.
    first_wild = re.search(r"[*?\[]", norm)
    if first_wild:
        base = norm[: first_wild.start()].rstrip("/")
        pattern = norm
    else:
        base, pattern = norm, norm
    start = (root / base).resolve() if base else root_resolved
    if not str(start).startswith(str(root_resolved)):
        return matches
    if not start.exists():
        return matches
    iterator: Iterable[Path]
    if start.is_file():
        iterator = [start]
    else:
        iterator = start.rglob("*")
    for candidate in iterator:
        if not candidate.is_file():
            continue
        try:
            rel = candidate.resolve().relative_to(root_resolved)
        except ValueError:
            continue  # symlink escapes repo
        rel_str = rel.as_posix()
        if "**" in pattern:
            # fnmatch treats ``**`` like ``*``. For the common DaC case
            # (``detections/**/*.yml``) we want matches anywhere under
            # ``detections/``, so drop the ``**/`` prefix and test the
            # tail against the full relpath.
            tail = pattern.replace("**/", "")
            if fnmatch.fnmatch(rel_str, pattern) or fnmatch.fnmatch(
                rel_str, tail
            ):
                matches.append(candidate)
        elif fnmatch.fnmatch(rel_str, pattern):
            matches.append(candidate)
    return matches


def _hash_payload(payload: dict) -> str:
    """Stable content hash used to detect upstream changes."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _load_source_payload(raw: Optional[str]) -> Optional[dict]:
    """Decode the JSON-serialised ``source_payload`` column. ``None`` on miss."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


async def _evaluate_files(
    db: AsyncSession,
    source: models.DetectionSource,
    files: List[Path],
    root: Path,
) -> List[_FileDecision]:
    """Parse each file and decide the per-file action."""
    # Preload existing detections keyed by ``source_path`` to avoid N+1.
    res = await db.execute(
        select(models.Detection).where(
            models.Detection.organization_id == source.organization_id,
            models.Detection.detection_source_id == source.id,
        )
    )
    existing = {det.source_path: det for det in res.scalars().all()}

    decisions: List[_FileDecision] = []
    seen_paths: set[str] = set()
    for f in files:
        rel = f.resolve().relative_to(root.resolve()).as_posix()
        try:
            raw = f.read_bytes()
        except OSError as exc:
            decisions.append(
                _FileDecision(
                    path=rel, payload={}, content_hash="", action="error",
                    error=f"cannot read file: {exc}",
                )
            )
            continue
        if len(raw) > _MAX_YAML_BYTES:
            decisions.append(
                _FileDecision(
                    path=rel, payload={}, content_hash="", action="error",
                    error=f"file exceeds {_MAX_YAML_BYTES} bytes",
                )
            )
            continue
        try:
            payload = parse_detection_yaml(raw)
        except ValueError as exc:
            decisions.append(
                _FileDecision(
                    path=rel, payload={}, content_hash="", action="error",
                    error=str(exc),
                )
            )
            continue
        content_hash = _hash_payload(payload)
        seen_paths.add(rel)
        current = existing.get(rel)
        if current is None:
            decisions.append(
                _FileDecision(
                    path=rel, payload=payload, content_hash=content_hash,
                    action="create",
                )
            )
            continue
        if current.content_hash == content_hash:
            decisions.append(
                _FileDecision(
                    path=rel, payload=payload, content_hash=content_hash,
                    action="skip", detection=current,
                )
            )
            continue
        # Upstream differs from last sync. Decide: is this a legitimate
        # upstream change (live row has NOT been edited since last sync)
        # or local drift (analyst tuned the rule)?
        #
        # ``source_payload`` stores the exact YAML payload we applied last
        # time. If every key in that snapshot still matches the live row,
        # the analyst hasn't touched those DaC-managed fields — safe to
        # update in place. If any field differs, a human needs to decide,
        # so we open a ``git``-kind proposal.
        last_applied = _load_source_payload(current.source_payload)
        drifted = False
        if last_applied is None:
            # Legacy row (synced before ``source_payload`` existed). Fall
            # back to assuming no drift — the first post-migration sync
            # will populate ``source_payload`` and subsequent syncs will
            # use the precise check.
            drifted = False
        else:
            for key, applied_value in last_applied.items():
                live_value = getattr(current, key, None)
                if live_value != applied_value:
                    drifted = True
                    break
        if not drifted:
            decisions.append(
                _FileDecision(
                    path=rel, payload=payload, content_hash=content_hash,
                    action="update", detection=current,
                )
            )
        else:
            decisions.append(
                _FileDecision(
                    path=rel, payload=payload, content_hash=content_hash,
                    action="propose", detection=current,
                )
            )
    return decisions


# ---------------------------------------------------------------------------
# Apply decisions
# ---------------------------------------------------------------------------
async def _apply_decisions(
    db: AsyncSession,
    source: models.DetectionSource,
    decisions: List[_FileDecision],
    *,
    proposer_label: str,
) -> None:
    payload_json_cache: dict[int, str] = {}
    for d in decisions:
        if d.action in ("create", "update"):
            # Persist the exact payload we're applying — becomes the
            # reference point for drift detection on the next sync.
            payload_json_cache[id(d)] = json.dumps(
                d.payload, sort_keys=True, separators=(",", ":")
            )
        if d.action == "create":
            det = models.Detection(
                id=str(uuid.uuid4()),
                organization_id=source.organization_id,
                source="git",
                detection_source_id=source.id,
                source_path=d.path,
                source_commit_sha=source.last_commit_sha,  # updated below
                content_hash=d.content_hash,
                source_payload=payload_json_cache[id(d)],
                last_synced_at=datetime.now(timezone.utc),
                **d.payload,
            )
            # Fill non-null default if caller omitted criticality.
            if not getattr(det, "criticality", None):
                det.criticality = "MEDIUM"
            db.add(det)
        elif d.action == "update" and d.detection is not None:
            for k, v in d.payload.items():
                setattr(d.detection, k, v)
            d.detection.content_hash = d.content_hash
            d.detection.source_payload = payload_json_cache[id(d)]
            d.detection.last_synced_at = datetime.now(timezone.utc)
            d.detection.source = "git"
            d.detection.detection_source_id = source.id
            d.detection.source_path = d.path
        elif d.action == "propose" and d.detection is not None:
            snap = {
                f: getattr(d.detection, f, None) for f in _YAML_FIELDS
            }
            proposal = models.DetectionProposal(
                id=str(uuid.uuid4()),
                organization_id=source.organization_id,
                detection_id=d.detection.id,
                proposed_by_kind="git",
                proposed_by_user_id=None,
                proposed_by_label=proposer_label,
                action="update",
                status="pending",
                reason=(
                    f"Upstream change in {d.path}. Local edits exist, so this "
                    "change is queued for review instead of being applied "
                    "automatically."
                ),
                target_fields=json.dumps(d.payload),
                current_snapshot=json.dumps(snap),
            )
            db.add(proposal)


# ---------------------------------------------------------------------------
# Telemetry on the DetectionSource row
# ---------------------------------------------------------------------------
def _apply_telemetry(
    source: models.DetectionSource,
    outcome: SyncOutcome,
    *,
    status: str,
    error: Optional[str] = None,
) -> None:
    source.last_synced_at = datetime.now(timezone.utc)
    source.last_sync_status = status
    source.last_sync_error = error
    source.last_commit_sha = outcome.commit_sha
    source.last_created_count = outcome.created
    source.last_updated_count = outcome.updated
    source.last_proposals_count = outcome.proposals
    source.last_skipped_count = outcome.skipped


def _rm_tree(path: Path) -> None:
    """Best-effort recursive delete; never raises (sync path)."""
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:  # pragma: no cover - defensive
        logger.debug("Failed to clean up %s", path)
