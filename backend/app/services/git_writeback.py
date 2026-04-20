"""Git-audit-mirror writer — serializes SIEM-synced detections as YAML and
commits them to a configured ``DetectionGitMirror`` repo.

Responsibilities
----------------
1. Clone the mirror repo into a tenant-scoped tempdir.
2. For each ``SIEMChangeEvent`` produced by ``detection_sync``, render the
   detection to YAML and write it into the path computed from the mirror's
   ``path_template``.
3. Commit one change set per sync with a structured, audit-friendly
   commit message (who/what/when, derived from the SIEM's own metadata
   where available).
4. Push to the configured write-target (direct to ``branch``, or to a
   timestamped audit branch, or to a PR branch).
5. Persist telemetry onto the mirror row + the linked SIEM connection.

Security
--------
* Same token-injection discipline as ``git_sync`` — credentials live on
  the URL, never in argv-echo or ``.git/config``.
* Tempdir is under ``tempfile.gettempdir()`` and is deleted after each
  run regardless of outcome.
* Path resolution rejects YAML targets that escape the clone root via
  ``..`` traversal. ``path_template`` is org-admin-controlled but we
  still defend-in-depth because it's rendered with external data.
* File size is bounded — any single detection's YAML that would exceed
  256 KiB is treated as a bug and the file is skipped with an error,
  never truncated.
"""

from __future__ import annotations

import logging
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from . import _git_common as git
from .detection_sync import SIEMChangeEvent
from .git_sync import detection_to_yaml

logger = logging.getLogger("purvex.services.git_writeback")

# Cap on a single detection's YAML file size. Anything above this is a
# latent bug (runaway field), not legitimate rule content.
_MAX_YAML_BYTES = 256 * 1024

# Which change actions produce a mirror commit. "skip" never does.
_MIRRORABLE_ACTIONS = {"create", "update", "propose"}


@dataclass
class MirrorOutcome:
    """Aggregated outcome of one mirror publish run."""

    mirror_id: int
    commit_sha: Optional[str] = None
    files_written: int = 0
    commits: int = 0
    skipped: int = 0
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "mirror_id": self.mirror_id,
            "commit_sha": self.commit_sha,
            "files_written": self.files_written,
            "commits": self.commits,
            "skipped": self.skipped,
            "errors": self.errors,
        }


async def publish_events(
    db: AsyncSession,
    mirror: models.DetectionGitMirror,
    connection: models.SIEMConnection,
    events: List[SIEMChangeEvent],
) -> MirrorOutcome:
    """Commit YAML files for ``events`` to the mirror repo.

    Idempotent. Events with ``action="skip"`` are filtered out before
    any git work so zero-delta syncs don't produce empty commits.
    """
    outcome = MirrorOutcome(mirror_id=mirror.id)

    mirrorable = [e for e in events if e.action in _MIRRORABLE_ACTIONS]
    if not mirrorable:
        _apply_telemetry(mirror, outcome, status="success")
        return outcome
    if not mirror.enabled:
        outcome.errors.append("mirror is disabled")
        _apply_telemetry(mirror, outcome, status="error", error="mirror disabled")
        return outcome

    tmpdir = Path(tempfile.mkdtemp(prefix=f"purvex-mirror-{mirror.id}-"))
    try:
        target_branch = _resolve_target_branch(mirror)
        # Clone the base branch always — the working tree will have
        # current state. For audit-branch mode we'll push to a different
        # ref; for direct/pr mode we push back to the same branch we
        # cloned.
        await git.clone_shallow(
            dest=tmpdir,
            repo_url=mirror.repo_url,
            branch=mirror.branch,
            auth_type=mirror.auth_type,
            auth_secret_encrypted=mirror.auth_secret,
        )

        written = await _write_yaml_files(
            db=db,
            repo_root=tmpdir,
            mirror=mirror,
            connection=connection,
            events=mirrorable,
            outcome=outcome,
        )
        if not written:
            # Everything either errored or was a no-op (e.g. unchanged YAML).
            _apply_telemetry(mirror, outcome, status="success")
            return outcome

        # Stage + commit + push.
        commit_message = _render_commit_message(
            connection=connection, events=mirrorable
        )
        await _configure_identity(tmpdir, mirror)
        await _commit_all(
            cwd=tmpdir, message=commit_message, mirror=mirror
        )
        commit_sha = await _rev_parse_head(tmpdir)
        await git.push_branch(
            cwd=tmpdir,
            repo_url=mirror.repo_url,
            branch=target_branch,
            auth_type=mirror.auth_type,
            auth_secret_encrypted=mirror.auth_secret,
        )
        outcome.commit_sha = commit_sha
        outcome.commits = 1
        _apply_telemetry(mirror, outcome, status="success")
    except git.GitCommandError as exc:
        outcome.errors.append(str(exc))
        _apply_telemetry(mirror, outcome, status="error", error=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Unexpected mirror failure for mirror %s", mirror.id)
        outcome.errors.append(f"internal error: {exc}")
        _apply_telemetry(mirror, outcome, status="error", error=str(exc))
    finally:
        _rm_tree(tmpdir)
    return outcome


# ---------------------------------------------------------------------------
# YAML rendering + path resolution
# ---------------------------------------------------------------------------
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str, *, fallback: str = "rule") -> str:
    """Lowercase + non-alphanumeric collapsed to ``-``. Clipped to 100 chars."""
    if not text:
        return fallback
    out = _SLUG_RE.sub("-", text.strip().lower()).strip("-")
    if not out:
        return fallback
    return out[:100]


def _render_path(
    template: str,
    *,
    siem_type: str,
    technique_id: str,
    external_id: str,
    title: str,
) -> str:
    """Render ``path_template`` with per-rule values. All tokens are slugified
    or safely encoded so a malformed SIEM rule id can't break out of the glob.
    """
    return template.format(
        siem=_slugify(siem_type, fallback="siem"),
        technique_id=_slugify(technique_id, fallback="unmapped"),
        external_id=_slugify(external_id, fallback="rule"),
        slug=_slugify(title or external_id, fallback="rule"),
    )


def _safe_resolve(root: Path, rel: str) -> Optional[Path]:
    """Resolve ``root / rel``, rejecting anything that escapes ``root``.

    Returns the resolved absolute path, or ``None`` if the rel path would
    escape the repo (e.g. a ``path_template`` with an injected ``..``).
    """
    # Normalise separators and remove any leading ``/`` so ``rel`` is
    # always interpreted as repo-relative.
    norm = rel.replace("\\", "/").lstrip("/")
    candidate = (root / norm).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


async def _write_yaml_files(
    *,
    db: AsyncSession,
    repo_root: Path,
    mirror: models.DetectionGitMirror,
    connection: models.SIEMConnection,
    events: List[SIEMChangeEvent],
    outcome: MirrorOutcome,
) -> int:
    """Render + write one YAML file per event. Returns number written."""
    written = 0
    for event in events:
        if not event.detection_id:
            outcome.skipped += 1
            continue
        detection = await db.get(models.Detection, event.detection_id)
        if detection is None:
            outcome.skipped += 1
            continue
        rel_path = _render_path(
            mirror.path_template,
            siem_type=connection.siem_type or "siem",
            technique_id=detection.technique_id or "unmapped",
            external_id=event.external_id,
            title=detection.title or event.external_id,
        )
        target = _safe_resolve(repo_root, rel_path)
        if target is None:
            outcome.errors.append(
                f"path_template escapes repo root for rule '{event.external_id}'"
            )
            outcome.skipped += 1
            continue
        yaml_body = detection_to_yaml(detection)
        encoded = yaml_body.encode("utf-8")
        if len(encoded) > _MAX_YAML_BYTES:
            outcome.errors.append(
                f"rendered YAML exceeds {_MAX_YAML_BYTES} bytes for '{event.external_id}'"
            )
            outcome.skipped += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        # Skip write if the on-disk file is byte-identical. Keeps commits
        # meaningful — if every rule's YAML already matches the mirror,
        # the commit will be empty and we'll no-op at the commit step.
        if target.exists() and target.read_bytes() == encoded:
            continue
        target.write_bytes(encoded)
        outcome.files_written += 1
        written += 1
    return written


# ---------------------------------------------------------------------------
# Commit / push plumbing
# ---------------------------------------------------------------------------
def _resolve_target_branch(mirror: models.DetectionGitMirror) -> str:
    """Which ref we actually push to. Depends on ``write_mode``."""
    if mirror.write_mode == "branch":
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        return f"purvex-audit/{ts}"
    if mirror.write_mode == "pr":
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        return f"purvex-audit-pr/{ts}"
    # Default: direct push to base branch.
    return mirror.branch


async def _configure_identity(
    cwd: Path, mirror: models.DetectionGitMirror
) -> None:
    """Set commit author identity + line-ending policy on the clone.

    Local-only (``git config``, not ``--global``) so nothing leaks to the
    host's global git config. Forcing ``core.autocrlf=false`` here as well
    as at clone time belt-and-braces us against Windows hosts that would
    otherwise normalize line endings on ``add`` and produce phantom diffs.
    """
    for key, value in (
        ("user.name", mirror.commit_author_name),
        ("user.email", mirror.commit_author_email),
        ("core.autocrlf", "false"),
        ("core.eol", "lf"),
    ):
        rc, _, err = await git.run_git(["config", key, value], cwd=cwd)
        if rc != 0:
            raise git.GitCommandError(
                f"git config {key} failed: {err.strip()}"
            )


async def _commit_all(
    *, cwd: Path, message: str, mirror: models.DetectionGitMirror
) -> None:
    """``git add -A && git commit -m <message>``. Safe on empty staging."""
    rc, _, err = await git.run_git(["add", "-A"], cwd=cwd)
    if rc != 0:
        raise git.GitCommandError(f"git add failed: {err.strip()}")

    # Check whether there's anything to commit. Skip silently if not —
    # happens when every YAML was already up-to-date.
    rc, out, _ = await git.run_git(["status", "--porcelain"], cwd=cwd)
    if rc == 0 and not out.strip():
        logger.info("Mirror %s: nothing to commit", mirror.id)
        return

    rc, _, err = await git.run_git(
        ["commit", "-m", message],
        cwd=cwd,
    )
    if rc != 0:
        raise git.GitCommandError(f"git commit failed: {err.strip()}")


async def _rev_parse_head(cwd: Path) -> Optional[str]:
    rc, out, _ = await git.run_git(["rev-parse", "HEAD"], cwd=cwd)
    if rc != 0:
        return None
    return out.strip() or None


def _render_commit_message(
    *,
    connection: models.SIEMConnection,
    events: List[SIEMChangeEvent],
) -> str:
    """Compose a multi-line commit message that's useful to an auditor.

    Subject line summarises counts; body lists each rule's per-field
    delta + upstream authorship where the SIEM exposed it.
    """
    siem_name = connection.name or connection.siem_type or "siem"
    counts: dict = {}
    for e in events:
        counts[e.action] = counts.get(e.action, 0) + 1
    summary_parts = []
    if counts.get("create"):
        summary_parts.append(f"{counts['create']} created")
    if counts.get("update"):
        summary_parts.append(f"{counts['update']} updated")
    if counts.get("propose"):
        summary_parts.append(f"{counts['propose']} proposed")
    summary = ", ".join(summary_parts) if summary_parts else "no-op"
    subject = f"[siem-sync] {siem_name}: {summary}"

    lines: List[str] = [subject, ""]
    for e in events:
        rule_name = e.payload.get("title") or e.external_id
        head = f"- [{e.action}] {rule_name} (rule_id={e.external_id})"
        lines.append(head)
        if e.changed_fields:
            lines.append(f"    fields: {', '.join(e.changed_fields)}")
        if e.upstream_modified_by:
            lines.append(f"    upstream_by: {e.upstream_modified_by}")
        if e.upstream_modified_at:
            lines.append(
                f"    upstream_at: {e.upstream_modified_at.isoformat()}"
            )
    lines.append("")
    lines.append(
        f"Mirrored by PurveX from SIEM connection id={connection.id} "
        f"({connection.siem_type})"
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Telemetry + cleanup
# ---------------------------------------------------------------------------
def _apply_telemetry(
    mirror: models.DetectionGitMirror,
    outcome: MirrorOutcome,
    *,
    status: str,
    error: Optional[str] = None,
) -> None:
    mirror.last_mirrored_at = datetime.now(timezone.utc)
    mirror.last_mirror_status = status
    mirror.last_mirror_error = error
    if outcome.commit_sha:
        mirror.last_commit_sha = outcome.commit_sha
    mirror.last_commits_count = outcome.commits
    mirror.last_files_written = outcome.files_written


def _rm_tree(path: Path) -> None:
    """Best-effort recursive delete; never raises (sync path)."""
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:  # pragma: no cover - defensive
        logger.debug("Failed to clean up %s", path)


# ---------------------------------------------------------------------------
# Bootstrap (first-time full export)
# ---------------------------------------------------------------------------
async def bootstrap_mirror(
    db: AsyncSession,
    mirror: models.DetectionGitMirror,
    connection: models.SIEMConnection,
) -> MirrorOutcome:
    """One-time full export: write every current ``siem_sync`` detection on
    ``connection`` to the mirror as a single commit.

    Use this to seed a brand-new audit repo from the current state of the
    SIEM. After this, regular ``publish_events`` runs only write deltas.
    """
    from sqlalchemy import select

    res = await db.execute(
        select(models.Detection).where(
            models.Detection.organization_id == mirror.organization_id,
            models.Detection.siem_connection_id == connection.id,
            models.Detection.source == "siem_sync",
        )
    )
    detections = list(res.scalars().all())
    synthetic_events: List[SIEMChangeEvent] = [
        SIEMChangeEvent(
            action="create",
            detection_id=d.id,
            external_id=d.external_id or d.id,
            siem_type=connection.siem_type,
            payload={
                "title": d.title,
                "description": d.description,
                "siem_query": d.siem_query,
                "criticality": d.criticality,
                "technique_id": d.technique_id,
                "enabled_upstream": d.enabled_upstream,
            },
            changed_fields=["bootstrap"],
        )
        for d in detections
    ]
    return await publish_events(db, mirror, connection, synthetic_events)
