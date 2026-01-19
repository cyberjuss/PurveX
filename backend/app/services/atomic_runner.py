import secrets
import logging
from datetime import datetime, timedelta
import json
import asyncio
from typing import Optional

import anyio
from sqlalchemy import select, delete

from .. import models
from ..db import async_sessionmaker
from ..services.scoring import validate_detection_for_test, validate_telemetry_for_test
from ..services.ai_assistant import analyze_detection

logger = logging.getLogger(__name__)


async def get_db_session():
    async with async_sessionmaker() as session:
        yield session


def generate_marker(environment: str) -> str:
    """Generate a unique marker for atomic tests, tagged by environment."""
    return f"purvex_{environment}_{secrets.token_hex(4)}"


def run_atomic_test(technique_id: str, marker: str) -> str:
    """Stub for running an atomic test via SSH. Returns the command string.

    In v1 this does not actually talk to a VM yet – it returns the command
    string that *would* be executed so we can store it in TestArtifact.
    """
    logger.info("Simulating atomic test for %s with marker %s", technique_id, marker)
    command = (
        f'Invoke-AtomicTest {technique_id} -TestNumbers 1 -GetPrereqs '
        f'-ExecutionPolicy Bypass -CommandToExecute "echo {marker}"'
    )
    return command


async def _get_test_retention_days(db, org_id: int) -> int:
  """Return the configured test data retention window (in days) for this org."""
  try:
      stmt = select(models.TestingPolicy).where(
          (models.TestingPolicy.organization_id == org_id)
      )
      result = await db.execute(stmt)
      policy = result.scalar_one_or_none()
      if policy and getattr(policy, "test_data_retention_days", None):
          days = int(policy.test_data_retention_days)
      else:
          days = 90
  except Exception:
      days = 90
  return max(1, days)


async def _purge_old_test_data(db, org_id: int) -> None:
  """Purge old tests, artifacts and sample SIEM data based on retention policy."""
  days = await _get_test_retention_days(db, org_id)
  cutoff = datetime.utcnow() - timedelta(days=days)

  # Find old tests for this org that finished before the cutoff.
  result = await db.execute(
      select(models.Test.id).where(
          models.Test.organization_id == org_id,
          models.Test.finished_at != None,  # noqa: E711
          models.Test.finished_at < cutoff,
      )
  )
  old_test_ids = [row[0] for row in result]
  if not old_test_ids:
      return

  # Delete artifacts tied to those tests, then the tests themselves.
  await db.execute(
      delete(models.TestArtifact).where(models.TestArtifact.test_id.in_(old_test_ids))
  )
  await db.execute(
      delete(models.Test).where(models.Test.id.in_(old_test_ids))
  )
  await db.commit()


async def execute_test_pipeline(test_id: int, expected_org_id: int):
    """Executes the full test pipeline for a given test ID.
    
    SECURITY: Requires expected_org_id to prevent cross-tenant access.
    The test must belong to the specified organization.
    """
    async for db_session in get_db_session(): # Use async for to get the session
        db = db_session
        break # We only need one session

    try:
        # 1. Load Test + Detection from DB with org_id check for tenant isolation.
        result = await db.execute(
            select(models.Test)
            .filter(models.Test.id == test_id)
            .filter(models.Test.organization_id == expected_org_id)
        )
        test = result.scalar_one_or_none()
        if not test:
            logger.error(
                f"Test with ID {test_id} not found or does not belong to org {expected_org_id}."
            )
            return

        detection = None
        if test.detection_id:
            result = await db.execute(select(models.Detection).filter(models.Detection.id == test.detection_id))
            detection = result.scalar_one_or_none()
            if not detection:
                logger.error(f"Detection with ID {test.detection_id} not found.")
                # For scenario‑only tests we allow detection_id to be null; if it was
                # explicitly set but cannot be loaded we treat this as a hard error.
                return

        # 2. Set status="running", started_at=now
        test.status = "running"
        test.started_at = datetime.utcnow()
        db.add(test)
        await db.commit()
        await db.refresh(test)
        logger.info(f"Test {test_id} status set to 'running'.")

        # 3. Generate marker if not already set (should be set by router now)
        if not test.marker:
            test.marker = generate_marker(test.environment)
            db.add(test)
            await db.commit()
            await db.refresh(test)
            logger.info(f"Test {test_id} marker generated: {test.marker}")

        # 4. Run the atomic test (stubbed) and capture the command string.
        technique_id = detection.technique_id if detection is not None else (test.technique_id or "UNKNOWN")
        command_str = await anyio.to_thread.run_sync(run_atomic_test, technique_id, test.marker)
        logger.info("Atomic test command for %s: %s", test_id, command_str)

        # 5. Sleep a short delay (e.g., 30–60s) to simulate execution + log ingestion.
        await asyncio.sleep(10)

        # 6. Validate detection in the SIEM (telemetry + detection logic check).
        if detection is not None:
            result_status, score, sample_events = await anyio.to_thread.run_sync(
                validate_detection_for_test,
                test,
                detection,
            )
        else:
            result_status, score, sample_events = await anyio.to_thread.run_sync(
                validate_telemetry_for_test,
                test,
            )
        logger.info(f"Test {test_id} validation result: {result_status}, Score: {score}")

        # 7. Update Test: result, score, finished_at, status
        test.result = result_status
        test.score = score
        test.finished_at = datetime.utcnow()
        test.status = "completed"
        db.add(test)
        await db.commit()
        await db.refresh(test)
        logger.info("Test %s status set to 'completed'.", test_id)

        # 8. Update detection lifecycle fields based on this test outcome.
        if detection is not None:
            detection.last_tested_at = test.finished_at
            if result_status == "PASS":
                if not detection.last_pass_at or test.finished_at > detection.last_pass_at:
                    detection.last_pass_at = test.finished_at
                # PASS implies the alert fired for this marker in the SIEM.
                if not detection.last_alert_at or test.finished_at > detection.last_alert_at:
                    detection.last_alert_at = test.finished_at
                # Simple rule: high‑scoring PASS → mark as ACTIVE.
                if (score or 0) >= 80:
                    detection.status = "ACTIVE"
            elif result_status == "FAIL":
                if not detection.last_fail_at or test.finished_at > detection.last_fail_at:
                    detection.last_fail_at = test.finished_at
                detection.status = "NEEDS_IMPROVEMENT"
            # INCONCLUSIVE keeps status as‑is but still updates last_tested_at above.

            db.add(detection)
            await db.commit()
            await db.refresh(detection)
            logger.info("Detection %s lifecycle updated from test %s.", detection.id, test_id)

        # 9a. Apply simple data retention for old tests and SIEM samples.
        try:
            org_id = detection.organization_id if detection is not None else test.organization_id
            if org_id is not None:
                await _purge_old_test_data(db, org_id)
        except Exception as retention_err:  # pragma: no cover - defensive safety
            logger.warning("Error applying test data retention: %s", retention_err)

        # 10. Call analyze_detection (AI assistant) to enrich the test artifact.
        ai_result = await anyio.to_thread.run_sync(
            analyze_detection, test, detection, sample_events
        )
        logger.info("Test %s AI analysis completed.", test_id)

        # 11. Create a TestArtifact with command, sample events, and AI output.
        # CRITICAL: Set organization_id from test to enforce tenant isolation.
        artifact = models.TestArtifact(
            organization_id=test.organization_id,
            test_id=test.id,
            atomic_command=command_str,
            siem_sample_events=json.dumps(sample_events) if sample_events else "[]",
            ai_explanation=ai_result.get("ai_explanation"),
            ai_suggested_rule=ai_result.get("ai_suggested_rule"),
            ai_root_cause_category=ai_result.get("ai_root_cause_category"),
            ai_confidence_score=ai_result.get("ai_confidence_score"),
        )
        db.add(artifact)
        await db.commit()
        await db.refresh(artifact)
        logger.info("Test artifact for %s created.", test_id)

    except Exception as e:
        logger.error("Error in test pipeline for test ID %s: %s", test_id, e)
        if "test" in locals() and test is not None:
            test.status = "error"
            test.finished_at = datetime.utcnow()
            db.add(test)
            await db.commit()
            await db.refresh(test)
        else:
            logger.error("Could not update test status for ID %s because test was not loaded.", test_id)
