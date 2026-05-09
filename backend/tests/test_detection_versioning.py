"""Tests for the detection-versioning pipeline (Feature 1).

Covers two layers:

* The hash helper (``compute_detection_version_hash``): deterministic over
  the four rule-defining fields, immune to metadata edits, normalises
  ``None`` to empty string.

* The KPI endpoint (``GET /detections/{id}/version-kpis``): groups completed
  DETECTION_VALIDATION runs by hash, assigns server-side v1/v2 labels by
  ``first_seen`` order, marks ``is_current``, surfaces a synthetic
  current bucket when the live rule has no runs yet, collapses
  Legacy rows (NULL hash) into a labelled bucket, ignores
  non-validation modes and unfinished runs.

Tests call the router function directly (no test client). Admin users
short-circuit RBAC, mirroring the pattern in test_proposals.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


# ---------------------------------------------------------------------------
# Hash helper — pure unit, no DB needed
# ---------------------------------------------------------------------------
class _Stub:
    """Minimal stand-in so we don't need a Detection ORM instance to hash."""

    def __init__(self, **fields):
        for k, v in fields.items():
            setattr(self, k, v)


def _stub(**overrides):
    base = dict(
        siem_type="splunk",
        technique_id="T1059.001",
        siem_query="index=main process=powershell",
        sigma_rule=None,
        # Metadata fields the helper must IGNORE
        title="Suspicious PowerShell",
        description="some description",
        criticality="HIGH",
        owner="alice@example.test",
        notes="initial",
        lifecycle_stage="identify",
    )
    base.update(overrides)
    return _Stub(**base)


def test_hash_is_deterministic():
    from app.services.detection_versioning import compute_detection_version_hash

    a = compute_detection_version_hash(_stub())
    b = compute_detection_version_hash(_stub())
    assert a == b
    assert len(a) == 64  # sha256 hex digest


def test_hash_changes_when_siem_query_changes():
    from app.services.detection_versioning import compute_detection_version_hash

    before = compute_detection_version_hash(_stub(siem_query="index=main a=1"))
    after = compute_detection_version_hash(_stub(siem_query="index=main a=2"))
    assert before != after


def test_hash_changes_when_technique_id_changes():
    from app.services.detection_versioning import compute_detection_version_hash

    before = compute_detection_version_hash(_stub(technique_id="T1059.001"))
    after = compute_detection_version_hash(_stub(technique_id="T1059.003"))
    assert before != after


def test_hash_changes_when_siem_type_changes():
    from app.services.detection_versioning import compute_detection_version_hash

    before = compute_detection_version_hash(_stub(siem_type="splunk"))
    after = compute_detection_version_hash(_stub(siem_type="elastic"))
    assert before != after


def test_hash_changes_when_sigma_rule_changes():
    from app.services.detection_versioning import compute_detection_version_hash

    before = compute_detection_version_hash(_stub(sigma_rule=None))
    after = compute_detection_version_hash(_stub(sigma_rule="title: example"))
    assert before != after


def test_hash_ignores_metadata_edits():
    """Editing title/description/criticality/owner/notes/lifecycle MUST NOT
    change the hash. Otherwise every cosmetic edit pollutes the per-version
    KPI rollup with a fake "regression"."""
    from app.services.detection_versioning import compute_detection_version_hash

    base = compute_detection_version_hash(_stub())
    for field in ("title", "description", "criticality", "owner", "notes", "lifecycle_stage"):
        mutated = compute_detection_version_hash(_stub(**{field: "MUTATED"}))
        assert mutated == base, f"editing {field!r} must not change the version hash"


def test_hash_normalises_none_to_empty_string():
    """A rule that adds a sigma_rule for the first time must hash differently
    from one that never had one — both correct outcomes — but NULL and ""
    must collapse to the same hash so the column type doesn't leak through.
    """
    from app.services.detection_versioning import compute_detection_version_hash

    a = compute_detection_version_hash(_stub(sigma_rule=None))
    b = compute_detection_version_hash(_stub(sigma_rule=""))
    assert a == b


def test_maybe_compute_returns_none_for_no_detection():
    from app.services.detection_versioning import maybe_compute_version_hash

    assert maybe_compute_version_hash(None) is None


def test_maybe_compute_returns_hash_for_real_detection():
    from app.services.detection_versioning import (
        compute_detection_version_hash,
        maybe_compute_version_hash,
    )

    det = _stub()
    assert maybe_compute_version_hash(det) == compute_detection_version_hash(det)


# ---------------------------------------------------------------------------
# Endpoint — integration against in-memory SQLite + ORM
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def kpi_context():
    from app import models
    import app.routers.detections as detections_router

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

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
        yield detections_router, session, admin

    await engine.dispose()


async def _seed_detection(session, models, **overrides):
    defaults = dict(
        id=str(uuid.uuid4()),
        title="Baseline Rule",
        description="",
        technique_id="T1059.001",
        criticality="HIGH",
        organization_id=1,
        status="ACTIVE",
        lifecycle_stage="identify",
        siem_type="splunk",
        siem_query="index=main process=powershell",
    )
    defaults.update(overrides)
    det = models.Detection(**defaults)
    session.add(det)
    await session.commit()
    return det


async def _seed_test(session, models, *, detection_id, version_hash, result, started_at,
                     mode="DETECTION_VALIDATION", status="completed"):
    t = models.Test(
        organization_id=1,
        detection_id=detection_id,
        technique_id="T1059.001",
        environment="lab",
        mode=mode,
        status=status,
        result=result,
        started_at=started_at,
        detection_version_hash=version_hash,
    )
    session.add(t)
    await session.commit()
    return t


@pytest.mark.asyncio
async def test_kpis_empty_detection_returns_synthetic_current_bucket(kpi_context):
    """Detection with no runs yet → exactly one synthetic bucket flagged
    is_current=True with runs=0, so the UI can prompt the user to validate."""
    from app import models
    from app.services.detection_versioning import compute_detection_version_hash

    detections, session, admin = kpi_context
    det = await _seed_detection(session, models)

    resp = await detections.get_detection_version_kpis(
        detection_id=det.id, db=session, current_user=admin
    )

    expected_hash = compute_detection_version_hash(det)
    assert resp.current_version_hash == expected_hash
    assert len(resp.versions) == 1
    only = resp.versions[0]
    assert only.is_current is True
    assert only.runs == 0
    assert only.version_hash == expected_hash
    assert only.first_seen is None
    assert only.last_seen is None


@pytest.mark.asyncio
async def test_kpis_multiple_versions_labelled_v1_v2_and_current_flagged(kpi_context):
    """Two distinct historical hashes + current rule that matches the second
    one → labels v1/v2 by first_seen ASC; v2 carries is_current."""
    from app import models
    from app.services.detection_versioning import compute_detection_version_hash

    detections, session, admin = kpi_context
    det = await _seed_detection(session, models, siem_query="index=main v2")

    # Hash for an *older* version of the rule.
    old_hash = compute_detection_version_hash(
        _Stub(siem_type="splunk", technique_id="T1059.001",
              siem_query="index=main v1", sigma_rule=None)
    )
    current_hash = compute_detection_version_hash(det)
    assert old_hash != current_hash

    now = datetime.now(timezone.utc)
    # v1 — three runs, two pass, one fail
    await _seed_test(session, models, detection_id=det.id, version_hash=old_hash,
                     result="pass", started_at=now - timedelta(days=10))
    await _seed_test(session, models, detection_id=det.id, version_hash=old_hash,
                     result="pass", started_at=now - timedelta(days=9))
    await _seed_test(session, models, detection_id=det.id, version_hash=old_hash,
                     result="fail", started_at=now - timedelta(days=8))
    # v2 (current) — two runs, one pass one fail
    await _seed_test(session, models, detection_id=det.id, version_hash=current_hash,
                     result="pass", started_at=now - timedelta(days=2))
    await _seed_test(session, models, detection_id=det.id, version_hash=current_hash,
                     result="fail", started_at=now - timedelta(days=1))

    resp = await detections.get_detection_version_kpis(
        detection_id=det.id, db=session, current_user=admin
    )

    by_label = {v.version_label: v for v in resp.versions}
    assert set(by_label) == {"v1", "v2"}
    # v1 is the older one
    assert by_label["v1"].version_hash == old_hash
    assert by_label["v1"].is_current is False
    assert by_label["v1"].runs == 3
    assert by_label["v1"].pass_rate == pytest.approx(2 / 3)
    assert by_label["v1"].fail_rate == pytest.approx(1 / 3)
    # v2 matches the live detection
    assert by_label["v2"].version_hash == current_hash
    assert by_label["v2"].is_current is True
    assert by_label["v2"].runs == 2
    assert by_label["v2"].pass_rate == 0.5
    assert by_label["v2"].fail_rate == 0.5


@pytest.mark.asyncio
async def test_kpis_legacy_bucket_lives_outside_versions_array(kpi_context):
    """NULL-hash runs are pre-versioning data and must NOT pollute the
    main ``versions`` list — they live on the response's ``legacy``
    field instead so the UI can render them as a collapsed footnote."""
    from app import models

    detections, session, admin = kpi_context
    det = await _seed_detection(session, models)

    now = datetime.now(timezone.utc)
    for i in range(2):
        await _seed_test(session, models, detection_id=det.id, version_hash=None,
                         result="pass", started_at=now - timedelta(days=20 + i))

    resp = await detections.get_detection_version_kpis(
        detection_id=det.id, db=session, current_user=admin
    )

    # Legacy must NOT show up in versions[] — that list is a clean linear
    # sequence (v1, v2, ..., current). Mixing in Legacy breaks ordering
    # and delta computation.
    assert all(v.version_label != "Legacy" for v in resp.versions)
    assert all(v.version_hash is not None for v in resp.versions if v.runs > 0 or not v.is_current)

    assert resp.legacy is not None
    assert resp.legacy.version_label == "Legacy"
    assert resp.legacy.version_hash is None
    assert resp.legacy.runs == 2
    assert resp.legacy.is_current is False
    assert resp.legacy.delta_pass_pct is None
    assert resp.legacy.compared_to_label is None


@pytest.mark.asyncio
async def test_kpis_compute_delta_pass_pct_against_immediate_predecessor(kpi_context):
    """The delta line is the panel's whole value prop: it tells the user
    "did my last edit hurt?" without asking them to subtract two
    numbers. v1 has no predecessor so delta is None; v2 must compare
    only against v1; rounding is to whole points."""
    from app import models
    from app.services.detection_versioning import compute_detection_version_hash

    detections, session, admin = kpi_context
    det = await _seed_detection(session, models, siem_query="index=main v2")

    old_hash = compute_detection_version_hash(
        _Stub(siem_type="splunk", technique_id="T1059.001",
              siem_query="index=main v1", sigma_rule=None)
    )
    current_hash = compute_detection_version_hash(det)
    now = datetime.now(timezone.utc)

    # v1: 4 pass / 1 fail = 80% pass
    for i in range(4):
        await _seed_test(session, models, detection_id=det.id, version_hash=old_hash,
                         result="pass", started_at=now - timedelta(days=10, hours=i))
    await _seed_test(session, models, detection_id=det.id, version_hash=old_hash,
                     result="fail", started_at=now - timedelta(days=9))
    # v2 (current): 1 pass / 4 fail = 20% pass — a 60 point regression
    await _seed_test(session, models, detection_id=det.id, version_hash=current_hash,
                     result="pass", started_at=now - timedelta(days=2))
    for i in range(4):
        await _seed_test(session, models, detection_id=det.id, version_hash=current_hash,
                         result="fail", started_at=now - timedelta(days=1, hours=i))

    resp = await detections.get_detection_version_kpis(
        detection_id=det.id, db=session, current_user=admin
    )
    by_label = {v.version_label: v for v in resp.versions}

    # v1 has no predecessor — delta must stay None.
    assert by_label["v1"].delta_pass_pct is None
    assert by_label["v1"].compared_to_label is None

    # v2 must report the delta (-60) and name v1 as the comparison.
    assert by_label["v2"].delta_pass_pct == -60
    assert by_label["v2"].compared_to_label == "v1"


@pytest.mark.asyncio
async def test_kpis_skip_delta_when_either_side_has_zero_runs(kpi_context):
    """If the live rule has been edited but never validated, the
    synthetic empty-current bucket has runs=0. We must NOT display a
    delta there — comparing 0/0 against any predecessor produces a
    nonsense '▼' arrow that looks like a regression but isn't."""
    from app import models
    from app.services.detection_versioning import compute_detection_version_hash

    detections, session, admin = kpi_context
    det = await _seed_detection(session, models, siem_query="index=main v2")

    old_hash = compute_detection_version_hash(
        _Stub(siem_type="splunk", technique_id="T1059.001",
              siem_query="index=main v1", sigma_rule=None)
    )
    now = datetime.now(timezone.utc)
    # Historical v1 with real runs.
    await _seed_test(session, models, detection_id=det.id, version_hash=old_hash,
                     result="pass", started_at=now - timedelta(days=5))
    # Current rule has been edited but never re-tested → synthetic empty bucket.

    resp = await detections.get_detection_version_kpis(
        detection_id=det.id, db=session, current_user=admin
    )
    current = next(v for v in resp.versions if v.is_current)
    assert current.runs == 0
    assert current.delta_pass_pct is None
    assert current.compared_to_label is None


@pytest.mark.asyncio
async def test_kpis_excludes_non_validation_modes(kpi_context):
    """ALERT_CHECK and TELEMETRY_CHECK runs are not 'did the rule fire?'
    tests and must not appear in the per-version pass-rate."""
    from app import models
    from app.services.detection_versioning import compute_detection_version_hash

    detections, session, admin = kpi_context
    det = await _seed_detection(session, models)
    h = compute_detection_version_hash(det)
    now = datetime.now(timezone.utc)

    # One real validation run...
    await _seed_test(session, models, detection_id=det.id, version_hash=h,
                     result="pass", started_at=now - timedelta(hours=2),
                     mode="DETECTION_VALIDATION")
    # ...plus polluting modes that must be ignored.
    await _seed_test(session, models, detection_id=det.id, version_hash=h,
                     result="fail", started_at=now - timedelta(hours=1),
                     mode="ALERT_CHECK")
    await _seed_test(session, models, detection_id=det.id, version_hash=h,
                     result="fail", started_at=now - timedelta(minutes=30),
                     mode="TELEMETRY_CHECK")

    resp = await detections.get_detection_version_kpis(
        detection_id=det.id, db=session, current_user=admin
    )

    current = next(v for v in resp.versions if v.is_current)
    assert current.runs == 1
    assert current.pass_rate == 1.0
    assert current.fail_rate == 0.0


@pytest.mark.asyncio
async def test_kpis_excludes_unfinished_runs(kpi_context):
    """Pending / running tests aren't outcomes yet, so they must not move
    the rate — only ``status='completed'`` rows count."""
    from app import models
    from app.services.detection_versioning import compute_detection_version_hash

    detections, session, admin = kpi_context
    det = await _seed_detection(session, models)
    h = compute_detection_version_hash(det)
    now = datetime.now(timezone.utc)

    await _seed_test(session, models, detection_id=det.id, version_hash=h,
                     result="pass", started_at=now - timedelta(hours=2),
                     status="completed")
    await _seed_test(session, models, detection_id=det.id, version_hash=h,
                     result=None, started_at=now - timedelta(hours=1),
                     status="running")
    await _seed_test(session, models, detection_id=det.id, version_hash=h,
                     result=None, started_at=now - timedelta(minutes=30),
                     status="pending")

    resp = await detections.get_detection_version_kpis(
        detection_id=det.id, db=session, current_user=admin
    )
    current = next(v for v in resp.versions if v.is_current)
    assert current.runs == 1


# ---------------------------------------------------------------------------
# Snapshot wiring — proves the glue line in routers/tests.py:208 is alive
# ---------------------------------------------------------------------------
# Without this, a regression where ``maybe_compute_version_hash(detection)``
# is dropped from the Test() constructor would silently store NULL on every
# run forever — the panel would still render, just with everything bucketed
# as Legacy. Catching that requires exercising run_test() end-to-end
# rather than testing the helper and the endpoint in isolation.
@pytest.mark.asyncio
async def test_run_test_endpoint_populates_version_hash_on_created_test(
    kpi_context, monkeypatch
):
    from fastapi import BackgroundTasks
    from app import models, schemas
    import app.routers.tests as tests_router
    from app.services.detection_versioning import compute_detection_version_hash

    _, session, admin = kpi_context
    det = await _seed_detection(session, models)

    # Neutralise the worker enqueue. We only care that the Test row landed
    # with the hash; whether the pipeline actually executed is a separate
    # concern (and would pull in arq / Redis / runner state).
    async def _noop_enqueue(*_args, **_kwargs):
        return None

    monkeypatch.setattr(tests_router, "enqueue_test_execution", _noop_enqueue)

    test_run = schemas.TestRunCreate(
        detection_id=det.id,
        environment="lab",
        mode="DETECTION_VALIDATION",
    )

    created = await tests_router.run_test(
        test_run=test_run,
        background_tasks=BackgroundTasks(),
        db=session,
        current_user=admin,
    )

    expected = compute_detection_version_hash(det)
    assert created.detection_version_hash == expected, (
        "run_test must snapshot the detection's version hash onto the "
        "Test row. If this fails, the glue in routers/tests.py was "
        "broken and every run will silently bucket as Legacy."
    )

    # Re-read from the DB to make sure the hash actually persisted, not
    # just lived in the response object.
    persisted = await session.get(models.Test, created.id)
    assert persisted is not None
    assert persisted.detection_version_hash == expected


@pytest.mark.asyncio
async def test_scheduler_path_populates_version_hash_on_executed_test(
    kpi_context, monkeypatch
):
    """The scheduler is the second test-creation path. Same risk as the
    router path: a regression that drops ``maybe_compute_version_hash``
    from the Test() constructor would silently store NULL on every
    scheduled run forever. Test here mirrors the router-path test."""
    from sqlalchemy import select
    from app import models
    import app.services.test_scheduler as scheduler
    from app.services.detection_versioning import compute_detection_version_hash

    _, session, admin = kpi_context
    det = await _seed_detection(session, models)

    sched = models.TestSchedule(
        organization_id=1,
        detection_id=det.id,
        technique_id=det.technique_id,
        environment="lab",
        mode="DETECTION_VALIDATION",
        schedule_type="once",
        enabled=True,
        next_run_at=datetime.now(timezone.utc),
        created_by_user_id=admin.id,
    )
    session.add(sched)
    await session.commit()
    await session.refresh(sched)

    # Stop the scheduler from kicking off the actual pipeline; we only
    # care that the row was created with the hash. Patching the pipeline
    # function itself (rather than asyncio.create_task) is critical —
    # globally replacing create_task would break pytest-asyncio.
    async def _noop_pipeline(*_a, **_k):
        return None

    monkeypatch.setattr(scheduler, "execute_test_pipeline", _noop_pipeline)

    await scheduler.execute_scheduled_test(sched, session)

    res = await session.execute(
        select(models.Test).where(models.Test.detection_id == det.id)
    )
    created = res.scalars().first()
    assert created is not None
    expected = compute_detection_version_hash(det)
    assert created.detection_version_hash == expected, (
        "execute_scheduled_test must snapshot the detection's version "
        "hash onto the Test row. If this fails, scheduled runs will "
        "silently bucket as Legacy."
    )
