import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import shlex
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import anyio
import paramiko
from sqlalchemy import delete, select

from .. import models
from ..db import async_sessionmaker
from ..services.ai_assistant import analyze_detection
from ..services.scoring import validate_detection_for_test, validate_telemetry_for_test

logger = logging.getLogger(__name__)
_TECHNIQUE_ID_RE = r"^T\d{4}(?:\.\d{3})?$"
_SSH_SHA256_RE = re.compile(r"(?:SHA256:)?([A-Za-z0-9+/]{32,}=*)")
# Atomic Red Team test names are short human-readable descriptions (e.g.
# "PowerShell -Version 2 Downgrade Attack"). This allowlist covers legitimate
# names while excluding every shell/PowerShell metacharacter ("`$&|;<>\)
# that would let atomic_test_name break out of the quoted argument it's
# embedded in when the command string is parsed by the remote runner's shell.
_ATOMIC_TEST_NAME_RE = re.compile(r"^[A-Za-z0-9 ,.\-_()/:]+$")


def generate_marker(environment: str, connection: Optional[models.SIEMConnection] = None) -> str:
    """Generate a unique marker for atomic tests, tagged by environment.

    Honors the SIEM connection's `log_marker_pattern` so customers who have
    rebranded their PurveX integration (e.g. `acme_purvex_*`) get markers that
    match the SIEM-side filter the analyst already configured.
    """
    pattern = (getattr(connection, "log_marker_pattern", None) or "purvex_*").strip()
    if "*" in pattern:
        prefix = pattern.replace("*", "")
    else:
        prefix = pattern.rstrip("_") + "_"
    if not prefix:
        prefix = "purvex_"
    suffix = f"{environment}_{secrets.token_hex(4)}"
    return f"{prefix}{suffix}"


def _runner_snapshot(runner: models.EnvironmentRunnerConfig) -> Dict[str, Any]:
    return {
        "id": runner.id,
        "environment_name": runner.environment_name,
        "runner_type": runner.runner_type,
        "hostname": runner.hostname,
        "port": runner.port or 22,
        "username": runner.username,
        "auth_method": runner.auth_method,
        "key_path": runner.key_path,
        "ssh_host_key_sha256": runner.ssh_host_key_sha256,
        "os": (runner.os or "").lower(),
    }


def _ssh_host_key_sha256(key: paramiko.PKey) -> str:
    digest = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")
    return f"SHA256:{digest}"


def _normalize_ssh_host_key_sha256(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    match = _SSH_SHA256_RE.search(value.strip())
    if not match:
        return None
    return f"SHA256:{match.group(1).rstrip('=')}"


class PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def __init__(self, expected_sha256: str):
        self.expected_sha256 = expected_sha256

    def missing_host_key(self, client: paramiko.SSHClient, hostname: str, key: paramiko.PKey) -> None:
        _verify_host_key_sha256(hostname, key, self.expected_sha256)
        client.get_host_keys().add(hostname, key.get_name(), key)


def _verify_host_key_sha256(hostname: str, key: paramiko.PKey, expected_sha256: str) -> None:
    actual_sha256 = _ssh_host_key_sha256(key)
    if not hmac.compare_digest(actual_sha256, expected_sha256):
        raise paramiko.SSHException(
            f"SSH host key fingerprint mismatch for {hostname}. "
            f"Expected {expected_sha256}, got {actual_sha256}."
        )


def _verify_transport_host_key(client: paramiko.SSHClient, hostname: str, expected_sha256: str) -> None:
    transport = client.get_transport()
    if transport is None:
        raise paramiko.SSHException(f"SSH transport was not established for {hostname}.")
    key = transport.get_remote_server_key()
    if key is None:
        raise paramiko.SSHException(f"SSH host key was not presented by {hostname}.")
    _verify_host_key_sha256(hostname, key, expected_sha256)


def _atomic_selector(
    atomic_test_number: Optional[int] = None,
    atomic_test_name: Optional[str] = None,
    *,
    powershell: bool,
) -> str:
    if atomic_test_number is not None:
        if atomic_test_number < 1 or atomic_test_number > 999:
            raise RuntimeError(f"Invalid Atomic test number: {atomic_test_number!r}")
        return f"-TestNumbers {atomic_test_number}"

    if atomic_test_name:
        # SECURITY: this string is embedded directly into a remote shell
        # command sent over SSH (see _build_atomic_command). Quote-escaping
        # alone is not sufficient — a literal `"` breaks out of the outer
        # quoted -Command argument on Win32-OpenSSH's default cmd.exe exec
        # shell regardless of how the inner single quotes are escaped — so
        # reject anything outside a strict allowlist instead of trying to
        # escape it.
        if not _ATOMIC_TEST_NAME_RE.fullmatch(atomic_test_name):
            raise RuntimeError(f"Invalid atomic_test_name: {atomic_test_name!r}")
        safe_name = atomic_test_name.replace("'", "''" if powershell else "'\"'\"'")
        return f"-TestNames '{safe_name}'"

    return "-TestNumbers 1"


def _build_atomic_command(
    technique_id: str,
    marker: str,
    runner: Dict[str, Any],
    atomic_test_number: Optional[int] = None,
    atomic_test_name: Optional[str] = None,
) -> str:
    technique_id = technique_id.strip().upper()
    if not re.fullmatch(_TECHNIQUE_ID_RE, technique_id):
        raise RuntimeError(f"Invalid technique_id for atomic execution: {technique_id!r}")

    is_windows = "win" in (runner.get("os") or "")
    safe_marker = marker.replace("'", "''")
    if is_windows:
        safe_technique_id = technique_id.replace("'", "''")
        selector = _atomic_selector(atomic_test_number, atomic_test_name, powershell=True)
        return (
            "powershell -NoProfile -ExecutionPolicy Bypass -Command "
            f"\"$ErrorActionPreference='Stop'; "
            f"try {{ eventcreate /T INFORMATION /ID 100 /L APPLICATION /SO PurveX /D '{safe_marker}' | Out-Null }} catch {{}}; "
            f"Import-Module Invoke-AtomicRedTeam -ErrorAction Stop; "
            f"Invoke-AtomicTest '{safe_technique_id}' {selector} -GetPrereqs\""
        )
    safe_technique_id = shlex.quote(technique_id)
    safe_marker_shell = shlex.quote(marker)
    selector = _atomic_selector(atomic_test_number, None, powershell=True)
    return (
        "bash -lc "
        f"\"logger -t purvex {safe_marker_shell} || true; "
        f"pwsh -NoProfile -Command 'Import-Module Invoke-AtomicRedTeam -ErrorAction Stop; "
        f"Invoke-AtomicTest {safe_technique_id} {selector} -GetPrereqs'\""
    )


def run_atomic_test(
    technique_id: str,
    marker: str,
    runner: Optional[Dict[str, Any]],
    atomic_test_number: Optional[int] = None,
    atomic_test_name: Optional[str] = None,
) -> str:
    """Run an Atomic Red Team test over SSH using the configured runner."""
    if not runner:
        raise RuntimeError("No environment runner is configured for this test.")
    if (runner.get("runner_type") or "").upper() != "SSH":
        raise RuntimeError(f"Unsupported runner type: {runner.get('runner_type')}")
    if not runner.get("hostname") or not runner.get("username"):
        raise RuntimeError("Runner hostname and username are required for SSH execution.")
    ssh_host_key_sha256 = _normalize_ssh_host_key_sha256(runner.get("ssh_host_key_sha256"))
    if not ssh_host_key_sha256:
        raise RuntimeError(
            "Runner SSH host key SHA256 fingerprint is required for SSH execution. "
            "Enroll it from a trusted path before running validations."
        )

    command = _build_atomic_command(
        technique_id,
        marker,
        runner,
        atomic_test_number=atomic_test_number,
        atomic_test_name=atomic_test_name,
    )
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHostKeyPolicy(ssh_host_key_sha256))

    try:
        connect_kwargs: Dict[str, Any] = {
            "hostname": runner["hostname"],
            "port": int(runner.get("port") or 22),
            "username": runner["username"],
            "timeout": 20,
            "banner_timeout": 20,
            "auth_timeout": 20,
        }
        key_path = runner.get("key_path")
        if key_path:
            connect_kwargs["key_filename"] = key_path

        client.connect(**connect_kwargs)
        _verify_transport_host_key(client, runner["hostname"], ssh_host_key_sha256)
        _, stdout, stderr = client.exec_command(command, timeout=300)
        exit_status = stdout.channel.recv_exit_status()
        stderr_text = stderr.read().decode("utf-8", errors="ignore").strip()
        if exit_status != 0:
            raise RuntimeError(
                f"Atomic test command failed on runner {runner['hostname']} with exit code {exit_status}. {stderr_text}"
            )
        logger.info("Atomic test completed on runner %s", runner["hostname"])
        return command
    finally:
        client.close()


async def _get_test_retention_days(db, org_id: int) -> int:
    """Return the configured test data retention window (in days) for this org."""
    try:
        stmt = select(models.TestingPolicy).where(models.TestingPolicy.organization_id == org_id)
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

    await db.execute(delete(models.TestArtifact).where(models.TestArtifact.test_id.in_(old_test_ids)))
    await db.execute(delete(models.Test).where(models.Test.id.in_(old_test_ids)))
    await db.commit()


async def execute_test_pipeline(test_id: int, expected_org_id: int):
    """Execute the full test pipeline for a given test ID."""
    async with async_sessionmaker() as db:
        try:
            result = await db.execute(
                select(models.Test)
                .filter(models.Test.id == test_id)
                .filter(models.Test.organization_id == expected_org_id)
            )
            test = result.scalar_one_or_none()
            if not test:
                logger.error(
                    "Test with ID %s not found or does not belong to org %s.",
                    test_id,
                    expected_org_id,
                )
                return

            detection = None
            if test.detection_id:
                result = await db.execute(select(models.Detection).filter(models.Detection.id == test.detection_id))
                detection = result.scalar_one_or_none()
                if not detection:
                    logger.error("Detection with ID %s not found.", test.detection_id)
                    return

            test.status = "running"
            test.started_at = datetime.utcnow()
            db.add(test)
            await db.commit()
            await db.refresh(test)

            runner_stmt = (
                select(models.EnvironmentRunnerConfig)
                .where(models.EnvironmentRunnerConfig.organization_id == test.organization_id)
                .where(models.EnvironmentRunnerConfig.environment_name == test.environment)
            )
            if test.endpoint:
                runner_stmt = runner_stmt.where(models.EnvironmentRunnerConfig.hostname == test.endpoint)
            runner_result = await db.execute(
                runner_stmt.order_by(
                    models.EnvironmentRunnerConfig.last_check_in.desc().nullslast(),
                    models.EnvironmentRunnerConfig.id.desc(),
                )
            )
            runner_config = runner_result.scalar_one_or_none()

            # Prefer the SIEM bound to the runner's host — that's where this
            # host's telemetry actually lands. Fall back to the org-wide most
            # recently validated connection only if no binding exists.
            siem_connection: Optional[models.SIEMConnection] = None
            if runner_config and getattr(runner_config, "siem_connection_id", None):
                bound = await db.execute(
                    select(models.SIEMConnection).where(
                        models.SIEMConnection.id == runner_config.siem_connection_id,
                        models.SIEMConnection.organization_id == test.organization_id,
                    )
                )
                siem_connection = bound.scalar_one_or_none()
            if siem_connection is None:
                siem_result = await db.execute(
                    select(models.SIEMConnection)
                    .where(models.SIEMConnection.organization_id == test.organization_id)
                    .order_by(
                        models.SIEMConnection.last_validated_at.desc().nullslast(),
                        models.SIEMConnection.id.desc(),
                    )
                    .limit(1)
                )
                siem_connection = siem_result.scalar_one_or_none()

            # Refuse to "validate" a SIEM-synced detection on a host whose
            # telemetry doesn't reach the SIEM that owns the rule. Without
            # this guard a PASS/FAIL would be meaningless — the alert could
            # never fire on that path regardless of detection quality.
            if (
                detection is not None
                and getattr(detection, "source", "manual") == "siem_sync"
                and detection.siem_connection_id is not None
                and siem_connection is not None
                and detection.siem_connection_id != siem_connection.id
            ):
                raise RuntimeError(
                    f"Detection {detection.id} was synced from SIEM connection "
                    f"{detection.siem_connection_id} but the selected runner is bound to "
                    f"SIEM connection {siem_connection.id}. Bind the host to the matching "
                    "SIEM or pick a different runner."
                )

            if not test.marker:
                test.marker = generate_marker(test.environment, siem_connection)
                db.add(test)
                await db.commit()
                await db.refresh(test)

            technique_id = detection.technique_id if detection is not None else (test.technique_id or "UNKNOWN")
            runner_payload = _runner_snapshot(runner_config) if runner_config else None
            command_str = await anyio.to_thread.run_sync(
                run_atomic_test,
                technique_id,
                test.marker,
                runner_payload,
                test.atomic_test_number,
                test.atomic_test_name,
            )
            logger.info("Atomic test command for %s: %s", test_id, command_str)

            await asyncio.sleep(20)

            # Pick the validation strategy based on the user's stated intent
            # (test.mode), not just on whether a detection happens to be linked.
            # Behaviour matrix:
            #   TELEMETRY_CHECK     → always telemetry-only (no rule scoring,
            #                         no detection-status mutation below)
            #   ALERT_CHECK         → telemetry-only when no detection is linked,
            #                         detection scoring otherwise (legacy behavior)
            #   DETECTION_VALIDATION→ detection scoring when a detection is
            #                         linked, telemetry fallback otherwise
            run_mode = (getattr(test, "mode", None) or "DETECTION_VALIDATION").upper()
            use_telemetry_only = (
                run_mode == "TELEMETRY_CHECK" or detection is None
            )

            if not use_telemetry_only:
                result_status, score, sample_events = await anyio.to_thread.run_sync(
                    validate_detection_for_test,
                    test,
                    detection,
                    siem_connection,
                )
            else:
                result_status, score, sample_events = await anyio.to_thread.run_sync(
                    validate_telemetry_for_test,
                    test,
                    siem_connection,
                )

            test.result = result_status
            test.score = score
            test.finished_at = datetime.utcnow()
            test.status = "completed"
            db.add(test)
            await db.commit()
            await db.refresh(test)

            # Only update the detection's lifecycle counters when the rule was
            # actually evaluated. A telemetry-only run (TELEMETRY_CHECK or
            # detection-less) does not exercise the rule logic, so flipping
            # ACTIVE / NEEDS_IMPROVEMENT off its result would be misleading.
            if detection is not None and not use_telemetry_only:
                detection.last_tested_at = test.finished_at
                if result_status == "PASS":
                    if not detection.last_pass_at or test.finished_at > detection.last_pass_at:
                        detection.last_pass_at = test.finished_at
                    if not detection.last_alert_at or test.finished_at > detection.last_alert_at:
                        detection.last_alert_at = test.finished_at
                    if (score or 0) >= 80:
                        detection.status = "ACTIVE"
                elif result_status == "FAIL":
                    if not detection.last_fail_at or test.finished_at > detection.last_fail_at:
                        detection.last_fail_at = test.finished_at
                    detection.status = "NEEDS_IMPROVEMENT"

                db.add(detection)
                await db.commit()
                await db.refresh(detection)

            try:
                org_id = detection.organization_id if detection is not None else test.organization_id
                if org_id is not None:
                    await _purge_old_test_data(db, org_id)
            except Exception as retention_err:  # pragma: no cover
                logger.warning("Error applying test data retention: %s", retention_err)

            existing_artifact = None
            if detection is not None and not use_telemetry_only:
                try:
                    artifact_result = await db.execute(
                        select(models.TestArtifact).where(models.TestArtifact.test_id == test.id)
                    )
                    existing_artifact = artifact_result.scalar_one_or_none()
                except Exception:
                    existing_artifact = None

                if existing_artifact and existing_artifact.ai_explanation:
                    ai_result = {
                        "ai_explanation": existing_artifact.ai_explanation,
                        "ai_suggested_rule": existing_artifact.ai_suggested_rule,
                        "ai_root_cause_category": existing_artifact.ai_root_cause_category,
                        "ai_confidence_score": existing_artifact.ai_confidence_score,
                    }
                else:
                    ai_settings = None
                    try:
                        settings_result = await db.execute(
                            select(models.AIAssistantSettings).where(
                                models.AIAssistantSettings.organization_id == test.organization_id
                            )
                        )
                        ai_settings = settings_result.scalar_one_or_none()
                        if not ai_settings:
                            ai_settings = models.AIAssistantSettings(organization_id=test.organization_id)
                            db.add(ai_settings)
                            await db.commit()
                            await db.refresh(ai_settings)
                    except Exception:
                        ai_settings = None

                    ai_result = await anyio.to_thread.run_sync(
                        analyze_detection, test, detection, sample_events, ai_settings
                    )
            else:
                ai_result = {}

            if existing_artifact:
                existing_artifact.atomic_command = command_str
                existing_artifact.siem_sample_events = json.dumps(sample_events) if sample_events else "[]"
                existing_artifact.ai_explanation = ai_result.get("ai_explanation")
                existing_artifact.ai_suggested_rule = ai_result.get("ai_suggested_rule")
                existing_artifact.ai_root_cause_category = ai_result.get("ai_root_cause_category")
                existing_artifact.ai_confidence_score = ai_result.get("ai_confidence_score")
                db.add(existing_artifact)
                await db.commit()
                await db.refresh(existing_artifact)
            else:
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
