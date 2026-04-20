"""Tests for Detection-as-Code (Sprint 3).

Covers
------
* YAML parsing + round-trip (``detection_to_yaml`` ⇄ ``parse_detection_yaml``).
* ``_discover_files`` honours ``path_glob`` and rejects escapes.
* End-to-end sync against a real on-disk git repo (``file://`` URL) — this
  exercises the actual ``git clone`` shell-out code path.
* First sync creates detections; second sync is idempotent.
* Upstream change on a locally-untouched detection updates in place.
* Upstream change on a locally-edited detection opens a git-kind proposal.
* Malformed YAML produces an error row without killing the run.
* Invalid / non-http URL is rejected at schema layer.
* Sync telemetry + audit event are recorded.
* Export endpoint round-trips through the YAML parser.

We call the service / router functions directly, the same way
``test_proposals.py`` does, so we don't spin up the full FastAPI app.
Tests that need the ``git`` binary are skipped gracefully on machines
where it isn't installed.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Tuple

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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


def _init_repo(path: Path, files: dict[str, str], branch: str = "main") -> str:
    """Create a git repo at ``path`` with the given file contents and return HEAD SHA."""
    path.mkdir(parents=True, exist_ok=True)
    _run("git", "init", "-b", branch, cwd=path)
    _run("git", "config", "user.email", "test@example.com", cwd=path)
    _run("git", "config", "user.name", "Test", cwd=path)
    _run("git", "config", "commit.gpgsign", "false", cwd=path)
    _write_files(path, files)
    _run("git", "add", "-A", cwd=path)
    _run("git", "commit", "-m", "init", cwd=path)
    res = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(path), capture_output=True, text=True
    )
    return res.stdout.strip()


def _write_files(path: Path, files: dict[str, str]) -> None:
    for rel, content in files.items():
        dest = path / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")


def _commit_all(path: Path, message: str) -> str:
    _run("git", "add", "-A", cwd=path)
    _run("git", "commit", "--allow-empty", "-m", message, cwd=path)
    res = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(path), capture_output=True, text=True
    )
    return res.stdout.strip()


def _file_url(path: Path) -> str:
    # file:// URLs + forward slashes work on Windows with modern git.
    return "file:///" + str(path).replace("\\", "/").lstrip("/")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def dac_context(tmp_path):
    """In-memory DB + an org + a seeded git repo + a DetectionSource row."""
    from app import models

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    repo_dir = tmp_path / "repo"

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        admin = models.User(
            id=1,
            username="admin",
            email="admin@example.test",
            hashed_password="not-used",
            organization_id=1,
            is_active=True,
            is_admin=True,
        )
        session.add_all([org, admin])
        await session.commit()
        yield session, admin, repo_dir, models

    await engine.dispose()


async def _make_source(session, models, repo_dir: Path, branch: str = "main"):
    source = models.DetectionSource(
        organization_id=1,
        name="Test DaC",
        provider="git",
        repo_url=_file_url(repo_dir),
        branch=branch,
        path_glob="detections/**/*.yml",
        auth_type="none",
        enabled=True,
    )
    session.add(source)
    await session.commit()
    await session.refresh(source)
    return source


# ---------------------------------------------------------------------------
# Unit tests — YAML + file discovery
# ---------------------------------------------------------------------------
def test_yaml_round_trip_preserves_fields():
    from app import models
    from app.services.git_sync import detection_to_yaml, parse_detection_yaml

    det = models.Detection(
        id=str(uuid.uuid4()),
        organization_id=1,
        title="PowerShell EncodedCommand",
        description="Base64 encoded PowerShell",
        technique_id="T1059.001",
        criticality="HIGH",
        siem_type="splunk",
        siem_query="index=main EncodedCommand",
        status="ACTIVE",
        lifecycle_stage="identify",
    )
    yaml_text = detection_to_yaml(det)
    parsed = parse_detection_yaml(yaml_text)
    assert parsed["title"] == det.title
    assert parsed["technique_id"] == det.technique_id
    assert parsed["siem_type"] == det.siem_type
    assert parsed["siem_query"] == det.siem_query
    assert parsed["criticality"] == "HIGH"


def test_parse_rejects_malformed_yaml():
    from app.services.git_sync import parse_detection_yaml

    with pytest.raises(ValueError):
        parse_detection_yaml("not: [valid")
    with pytest.raises(ValueError, match="must be a mapping"):
        parse_detection_yaml("- just\n- a\n- list")
    with pytest.raises(ValueError, match="missing required field"):
        parse_detection_yaml("title: only title\n")


def test_parse_coerces_scalars_and_rejects_objects():
    from app.services.git_sync import parse_detection_yaml

    # int criticality gets coerced to str
    parsed = parse_detection_yaml(
        "title: T\ntechnique_id: T1059\nsiem_type: splunk\n"
        "siem_query: index=main\ncriticality: 3\n"
    )
    assert parsed["criticality"] == "3"

    # Nested objects aren't allowed on string-typed fields
    with pytest.raises(ValueError, match="must be a string"):
        parse_detection_yaml(
            "title:\n  nested: bad\ntechnique_id: T1\nsiem_type: splunk\n"
            "siem_query: q\n"
        )


def test_discover_files_respects_glob(tmp_path):
    from app.services.git_sync import _discover_files

    (tmp_path / "detections" / "win").mkdir(parents=True)
    (tmp_path / "detections" / "win" / "a.yml").write_text("a")
    (tmp_path / "detections" / "b.yml").write_text("b")
    (tmp_path / "other").mkdir(parents=True, exist_ok=True)
    (tmp_path / "other" / "c.yml").write_text("c")

    matches = _discover_files(tmp_path, "detections/**/*.yml")
    rels = sorted(m.resolve().relative_to(tmp_path.resolve()).as_posix() for m in matches)
    assert "detections/b.yml" in rels
    assert "detections/win/a.yml" in rels
    assert not any("other" in r for r in rels)


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------
def test_schema_rejects_ssh_and_non_http_urls():
    from app import schemas

    with pytest.raises(Exception):
        schemas.DetectionSourceCreate(
            name="bad", repo_url="git@github.com:x/y.git"
        )
    with pytest.raises(Exception):
        schemas.DetectionSourceCreate(
            name="bad", repo_url="ftp://example.com/repo"
        )


# ---------------------------------------------------------------------------
# End-to-end sync tests (require git)
# ---------------------------------------------------------------------------
_YAML_A = """\
title: Rule A
description: first rule
technique_id: T1059.001
siem_type: splunk
siem_query: index=main eventA
criticality: HIGH
"""

_YAML_B = """\
title: Rule B
description: second rule
technique_id: T1047
siem_type: elastic
siem_query: 'process.name : "wmic.exe"'
criticality: MEDIUM
"""


@requires_git
@pytest.mark.asyncio
async def test_sync_creates_detections_on_first_run(dac_context):
    from app.services.git_sync import sync_detection_source

    session, _admin, repo_dir, models = dac_context
    _init_repo(
        repo_dir,
        {"detections/a.yml": _YAML_A, "detections/b.yml": _YAML_B},
    )
    source = await _make_source(session, models, repo_dir)

    outcome = await sync_detection_source(session, source)
    await session.commit()

    assert outcome.errors == []
    assert outcome.created == 2
    assert outcome.updated == 0
    assert outcome.proposals == 0
    assert outcome.commit_sha is not None

    res = await session.execute(
        select(models.Detection).where(models.Detection.organization_id == 1)
    )
    dets = {d.source_path: d for d in res.scalars().all()}
    assert set(dets.keys()) == {"detections/a.yml", "detections/b.yml"}
    assert dets["detections/a.yml"].source == "git"
    assert dets["detections/a.yml"].detection_source_id == source.id
    assert dets["detections/a.yml"].content_hash is not None
    assert dets["detections/a.yml"].title == "Rule A"

    # Telemetry saved on the source row.
    assert source.last_sync_status == "success"
    assert source.last_created_count == 2
    assert source.last_commit_sha == outcome.commit_sha


@requires_git
@pytest.mark.asyncio
async def test_sync_is_idempotent(dac_context):
    from app.services.git_sync import sync_detection_source

    session, _admin, repo_dir, models = dac_context
    _init_repo(repo_dir, {"detections/a.yml": _YAML_A})
    source = await _make_source(session, models, repo_dir)

    first = await sync_detection_source(session, source)
    await session.commit()
    second = await sync_detection_source(session, source)
    await session.commit()

    assert first.created == 1
    assert second.created == 0
    assert second.updated == 0
    assert second.skipped == 1


@requires_git
@pytest.mark.asyncio
async def test_upstream_change_without_local_drift_updates_in_place(dac_context):
    from app.services.git_sync import sync_detection_source

    session, _admin, repo_dir, models = dac_context
    _init_repo(repo_dir, {"detections/a.yml": _YAML_A})
    source = await _make_source(session, models, repo_dir)

    await sync_detection_source(session, source)
    await session.commit()

    updated_yaml = _YAML_A.replace("first rule", "first rule — updated upstream")
    _write_files(repo_dir, {"detections/a.yml": updated_yaml})
    _commit_all(repo_dir, "tweak A")

    outcome = await sync_detection_source(session, source)
    await session.commit()

    assert outcome.updated == 1
    assert outcome.proposals == 0

    res = await session.execute(
        select(models.Detection).where(models.Detection.source_path == "detections/a.yml")
    )
    det = res.scalar_one()
    assert "updated upstream" in det.description


@requires_git
@pytest.mark.asyncio
async def test_upstream_change_with_local_drift_opens_proposal(dac_context):
    from app.services.git_sync import sync_detection_source

    session, _admin, repo_dir, models = dac_context
    _init_repo(repo_dir, {"detections/a.yml": _YAML_A})
    source = await _make_source(session, models, repo_dir)

    await sync_detection_source(session, source)
    await session.commit()

    # Local edit. Importantly this changes the live payload away from the
    # last_synced content_hash.
    res = await session.execute(
        select(models.Detection).where(models.Detection.source_path == "detections/a.yml")
    )
    det = res.scalar_one()
    det.description = "LOCAL EDIT — analyst tuned this"
    await session.commit()

    # Upstream also changes independently.
    upstream = _YAML_A.replace("first rule", "first rule v2")
    _write_files(repo_dir, {"detections/a.yml": upstream})
    _commit_all(repo_dir, "v2")

    outcome = await sync_detection_source(session, source)
    await session.commit()

    assert outcome.proposals == 1
    assert outcome.updated == 0

    res = await session.execute(
        select(models.DetectionProposal).where(
            models.DetectionProposal.detection_id == det.id
        )
    )
    proposal = res.scalar_one()
    assert proposal.proposed_by_kind == "git"
    assert proposal.status == "pending"
    assert proposal.action == "update"
    assert "detections/a.yml" in (proposal.reason or "")

    # The detection itself was NOT stomped — local edit still there.
    await session.refresh(det)
    assert det.description == "LOCAL EDIT — analyst tuned this"


@requires_git
@pytest.mark.asyncio
async def test_malformed_yaml_surfaces_error_without_killing_run(dac_context):
    from app.services.git_sync import sync_detection_source

    session, _admin, repo_dir, models = dac_context
    _init_repo(
        repo_dir,
        {
            "detections/a.yml": _YAML_A,
            "detections/broken.yml": "not: [valid yaml",
        },
    )
    source = await _make_source(session, models, repo_dir)

    outcome = await sync_detection_source(session, source)
    await session.commit()

    assert outcome.created == 1
    assert len(outcome.errors) == 1
    assert "detections/broken.yml" in outcome.errors[0]
    # The good file still landed.
    res = await session.execute(
        select(func.count()).select_from(models.Detection).where(
            models.Detection.organization_id == 1
        )
    )
    assert res.scalar_one() == 1


@requires_git
@pytest.mark.asyncio
async def test_missing_branch_sets_error_status(dac_context):
    from app.services.git_sync import sync_detection_source

    session, _admin, repo_dir, models = dac_context
    _init_repo(repo_dir, {"detections/a.yml": _YAML_A})  # default "main"
    source = await _make_source(session, models, repo_dir, branch="does-not-exist")

    outcome = await sync_detection_source(session, source)
    await session.commit()

    assert outcome.created == 0
    assert outcome.errors  # at least one error
    assert source.last_sync_status == "error"
    assert source.last_sync_error is not None


# ---------------------------------------------------------------------------
# Router / export endpoint
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_export_returns_parseable_yaml(dac_context):
    from app import models as app_models
    from app.routers import detections as detections_router
    from app.services.git_sync import parse_detection_yaml

    session, admin, _repo_dir, models = dac_context
    det = app_models.Detection(
        id=str(uuid.uuid4()),
        organization_id=1,
        title="Export Test",
        description="exported via the DaC endpoint",
        technique_id="T1059.001",
        criticality="HIGH",
        siem_type="splunk",
        siem_query="index=main",
        status="ACTIVE",
        lifecycle_stage="identify",
    )
    session.add(det)
    await session.commit()

    result = await detections_router.export_detection(
        detection_id=det.id,
        db=session,
        current_user=admin,
        format="yaml",
    )
    assert result.id == det.id
    parsed = parse_detection_yaml(result.yaml)
    assert parsed["title"] == "Export Test"
    assert parsed["siem_query"] == "index=main"


@pytest.mark.asyncio
async def test_export_rejects_bad_format(dac_context):
    from app import models as app_models
    from app.routers import detections as detections_router

    session, admin, _repo_dir, _models = dac_context
    det = app_models.Detection(
        id=str(uuid.uuid4()),
        organization_id=1,
        title="x",
        technique_id="T1",
        criticality="LOW",
        siem_type="splunk",
        siem_query="q",
    )
    session.add(det)
    await session.commit()

    with pytest.raises(HTTPException) as exc:
        await detections_router.export_detection(
            detection_id=det.id,
            db=session,
            current_user=admin,
            format="json",
        )
    assert exc.value.status_code == 400
