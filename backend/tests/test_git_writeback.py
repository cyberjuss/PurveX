"""Tests for the SIEM → Git audit mirror (Sprint 4).

Covers
------
* End-to-end ``publish_events`` pushes a commit to a real file:// remote
  and renders the expected YAML path.
* Second publish with identical events is a no-op (no empty commit).
* ``propose`` events are mirrored the same as create/update — the audit
  log should include *every* upstream change, even ones that PurveX
  chose not to apply locally.
* ``skip`` events are filtered out before cloning (fast-path).
* ``path_template`` traversal (``..``) is rejected without breaking the
  run.
* Bootstrap writes one file per existing detection.
* Commit message embeds the SIEM name + per-event changed fields.

Requires the ``git`` binary. Gracefully skipped otherwise.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import List

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


_HAS_GIT = shutil.which("git") is not None
requires_git = pytest.mark.skipif(
    not _HAS_GIT, reason="git binary not available on the test host"
)


def _run(*args: str, cwd: Path) -> None:
    subprocess.run(
        list(args),
        cwd=str(cwd),
        check=True,
        capture_output=True,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )


def _init_bare_and_work(tmp_path: Path) -> tuple[Path, Path]:
    """Create a bare origin repo + a working clone seeded with an initial commit.

    We push to the bare repo; assertions read from a fresh clone so we
    observe exactly what other consumers of the audit repo would see.
    """
    bare = tmp_path / "origin.git"
    work = tmp_path / "work"
    bare.mkdir()
    _run("git", "init", "--bare", "-b", "main", cwd=bare)
    work.mkdir()
    _run("git", "init", "-b", "main", cwd=work)
    _run("git", "config", "user.email", "seed@example.test", cwd=work)
    _run("git", "config", "user.name", "Seed", cwd=work)
    _run("git", "config", "commit.gpgsign", "false", cwd=work)
    (work / "README.md").write_text("audit mirror\n", encoding="utf-8")
    _run("git", "add", "-A", cwd=work)
    _run("git", "commit", "-m", "seed", cwd=work)
    _run("git", "remote", "add", "origin", _file_url(bare), cwd=work)
    _run("git", "push", "-u", "origin", "main", cwd=work)
    return bare, work


def _file_url(path: Path) -> str:
    return "file:///" + str(path).replace("\\", "/").lstrip("/")


def _fresh_clone(origin: Path, dest: Path) -> Path:
    _run(
        "git",
        "clone",
        _file_url(origin),
        str(dest),
        cwd=dest.parent,
    )
    return dest


@pytest_asyncio.fixture
async def mirror_context(tmp_path):
    from app import models

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    bare, _work = _init_bare_and_work(tmp_path)

    async with sm() as session:
        org = models.Organization(id=1, name="Audit Org")
        siem = models.SIEMConnection(
            organization_id=1,
            siem_type="splunk",
            name="prod-splunk",
            url="https://splunk.test",
            auth_type="token",
            credentials="{}",
        )
        mirror = models.DetectionGitMirror(
            organization_id=1,
            name="audit",
            repo_url=_file_url(bare),
            branch="main",
            path_template="detections/{siem}/{technique_id}/{slug}.yml",
            commit_author_name="Test Bot",
            commit_author_email="bot@test.local",
            write_mode="direct",
            auth_type="none",
            auth_secret=None,
            enabled=True,
        )
        session.add_all([org, siem, mirror])
        await session.commit()
        await session.refresh(siem)
        await session.refresh(mirror)

        # Seed one SIEM-synced detection so we have something to mirror.
        det = models.Detection(
            id=str(uuid.uuid4()),
            organization_id=1,
            technique_id="T1059.001",
            title="PowerShell EncodedCommand",
            description="Base64 encoded PS",
            siem_type="splunk",
            siem_query="index=main EncodedCommand",
            criticality="HIGH",
            source="siem_sync",
            siem_connection_id=siem.id,
            external_id="rule-1",
            content_hash="abc",
            source_payload='{"title":"PowerShell EncodedCommand"}',
        )
        session.add(det)
        await session.commit()
        await session.refresh(det)
        yield session, bare, mirror, siem, det, models, tmp_path
    await engine.dispose()


def _make_event(action: str, det, external_id: str, changed: List[str]):
    from app.services.detection_sync import SIEMChangeEvent

    return SIEMChangeEvent(
        action=action,
        detection_id=det.id,
        external_id=external_id,
        siem_type="splunk",
        payload={
            "title": det.title,
            "description": det.description,
            "siem_query": det.siem_query,
            "criticality": det.criticality,
            "technique_id": det.technique_id,
            "enabled_upstream": True,
        },
        changed_fields=changed,
    )


@requires_git
@pytest.mark.asyncio
async def test_publish_events_writes_yaml_and_pushes(mirror_context, tmp_path):
    from app.services.git_writeback import publish_events

    session, bare, mirror, siem, det, models, _ = mirror_context
    events = [_make_event("create", det, "rule-1", ["bootstrap"])]
    outcome = await publish_events(session, mirror, siem, events)
    await session.commit()

    assert outcome.files_written == 1
    assert outcome.commits == 1
    assert outcome.commit_sha
    assert mirror.last_mirror_status == "success"
    assert mirror.last_commits_count == 1

    verify = tmp_path / "verify"
    verify.mkdir()
    clone = _fresh_clone(bare, verify / "repo")
    # Slug derived from title "PowerShell EncodedCommand" → "powershell-encodedcommand"
    target = (
        clone
        / "detections"
        / "splunk"
        / "t1059-001"
        / "powershell-encodedcommand.yml"
    )
    assert target.exists(), sorted(p.as_posix() for p in clone.rglob("*.yml"))
    body = target.read_text("utf-8")
    assert "PowerShell EncodedCommand" in body
    assert "T1059.001" in body


@requires_git
@pytest.mark.asyncio
async def test_publish_events_is_noop_when_nothing_changes(
    mirror_context, tmp_path
):
    """Contract: after N publishes of identical state, there's exactly
    one audit commit beyond the seed. The ``git status --porcelain`` gate
    prevents empty commits even if file writes happen to be byte-identical.
    """
    from app.services.git_writeback import publish_events

    session, bare, mirror, siem, det, _models, _ = mirror_context
    events = [_make_event("update", det, "rule-1", ["siem_query"])]
    first = await publish_events(session, mirror, siem, events)
    await session.commit()
    assert first.commits == 1
    assert first.files_written == 1
    assert first.errors == []

    second = await publish_events(session, mirror, siem, events)
    await session.commit()
    # The commit step checks ``git status --porcelain`` and skips silently
    # if nothing changed — regardless of whether the write step happened
    # (bytes were identical) or not.
    assert second.commits == 0
    assert second.errors == []

    # Canonical check: the bare repo should have exactly 2 commits on main
    # (the seed + first publish). Second publish produced no new commit.
    verify = tmp_path / "verify_noop"
    verify.mkdir()
    clone = _fresh_clone(bare, verify / "repo")
    log_res = subprocess.run(
        ["git", "rev-list", "--count", "main"],
        cwd=str(clone),
        check=True,
        capture_output=True,
        text=True,
    )
    assert log_res.stdout.strip() == "2"


@requires_git
@pytest.mark.asyncio
async def test_propose_events_are_mirrored(mirror_context, tmp_path):
    """Even when PurveX chose not to apply a change locally (proposal),
    the audit mirror must still record the upstream edit."""
    from app.services.git_writeback import publish_events

    session, bare, mirror, siem, det, _models, _ = mirror_context
    events = [_make_event("propose", det, "rule-1", ["criticality"])]
    outcome = await publish_events(session, mirror, siem, events)
    await session.commit()
    assert outcome.commits == 1
    assert outcome.files_written == 1

    verify = tmp_path / "verify_propose"
    verify.mkdir()
    clone = _fresh_clone(bare, verify / "repo")
    yamls = list(clone.rglob("*.yml"))
    assert len(yamls) == 1


@requires_git
@pytest.mark.asyncio
async def test_skip_only_events_do_nothing(mirror_context):
    from app.services.git_writeback import publish_events

    session, _bare, mirror, siem, det, _models, _ = mirror_context
    events = [_make_event("skip", det, "rule-1", [])]
    outcome = await publish_events(session, mirror, siem, events)
    await session.commit()
    assert outcome.commits == 0
    assert outcome.files_written == 0
    assert mirror.last_mirror_status == "success"


@requires_git
@pytest.mark.asyncio
async def test_path_traversal_is_rejected(mirror_context):
    from app.services.git_writeback import publish_events

    session, _bare, mirror, siem, det, _models, _ = mirror_context
    # Caller-controlled path_template is validated by schema in production,
    # but the service must defend in depth.
    mirror.path_template = "../outside/{slug}.yml"
    await session.commit()

    events = [_make_event("create", det, "rule-1", ["bootstrap"])]
    outcome = await publish_events(session, mirror, siem, events)
    await session.commit()
    assert outcome.files_written == 0
    assert any(
        "escapes repo root" in e.lower() for e in outcome.errors
    )


@requires_git
@pytest.mark.asyncio
async def test_bootstrap_writes_all_current_detections(
    mirror_context, tmp_path
):
    """Bootstrap should emit one synthetic ``create`` event per existing
    ``siem_sync`` detection on the linked connection."""
    from app.services.git_writeback import bootstrap_mirror

    session, bare, mirror, siem, det, models, _ = mirror_context

    # Add a second siem-synced detection so we have >1 file to write.
    extra = models.Detection(
        id=str(uuid.uuid4()),
        organization_id=1,
        technique_id="T1047",
        title="WMI Execution",
        siem_type="splunk",
        siem_query='EventCode=4103 wmic.exe',
        criticality="MEDIUM",
        source="siem_sync",
        siem_connection_id=siem.id,
        external_id="rule-2",
        content_hash="def",
    )
    session.add(extra)
    await session.commit()

    outcome = await bootstrap_mirror(session, mirror, siem)
    await session.commit()
    assert outcome.files_written == 2
    assert outcome.commits == 1

    verify = tmp_path / "verify_bootstrap"
    verify.mkdir()
    clone = _fresh_clone(bare, verify / "repo")
    yamls = sorted(p.as_posix() for p in clone.rglob("*.yml"))
    assert len(yamls) == 2


@requires_git
@pytest.mark.asyncio
async def test_commit_message_records_change_provenance(
    mirror_context, tmp_path
):
    from app.services.git_writeback import publish_events

    session, bare, mirror, siem, det, _models, _ = mirror_context

    from app.services.detection_sync import SIEMChangeEvent

    events = [
        SIEMChangeEvent(
            action="update",
            detection_id=det.id,
            external_id="rule-1",
            siem_type="splunk",
            payload={
                "title": det.title,
                "description": det.description,
                "siem_query": det.siem_query,
                "criticality": det.criticality,
                "technique_id": det.technique_id,
                "enabled_upstream": True,
            },
            changed_fields=["criticality", "siem_query"],
            upstream_modified_by="alice@example.test",
        )
    ]
    await publish_events(session, mirror, siem, events)
    await session.commit()

    verify = tmp_path / "verify_msg"
    verify.mkdir()
    clone = _fresh_clone(bare, verify / "repo")
    res = subprocess.run(
        ["git", "log", "-1", "--pretty=%B"],
        cwd=str(clone),
        check=True,
        capture_output=True,
        text=True,
    )
    message = res.stdout
    assert "siem-sync" in message.lower()
    assert "rule-1" in message
    assert "criticality" in message
    assert "alice@example.test" in message
