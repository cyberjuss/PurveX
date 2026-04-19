"""
Reports Router - PDF Report Generation

Provides endpoints for generating and managing detection effectiveness reports.
"""

import uuid
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select, and_, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from .. import models
from ..models import Report, Detection, Test, User, Organization, DetectionScoring
from ..schemas import Report as ReportSchema, ReportCreate
from ..utils.authz import require_permission, Permission
from ..utils.tenant import require_org_id
from ..routers.auth import get_current_user
from typing_extensions import Annotated
from ..services.pdf_generator import (
    generate_pdf_report,
    calculate_health_score,
    get_mitre_coverage,
    derive_health_state
)

router = APIRouter(prefix="/reports", tags=["reports"])

# Ensure reports directory exists
REPORTS_DIR = Path("data/reports")
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


def _ensure_list_environments(report: Report) -> Report:
    """Mutate SQLAlchemy report so environments is a list for schema serialization."""
    if isinstance(report.environments, str):
        try:
            report.environments = json.loads(report.environments)
        except json.JSONDecodeError:
            report.environments = []
    return report


@router.post("/generate", response_model=ReportSchema)
async def generate_report(
    report_create: ReportCreate,
    db: DBSession,
    current_user: CurrentUser,
    request: Request,
):
    """
    Generate a comprehensive PDF report for the specified date range and environments.
    """
    await require_permission(current_user, Permission.DETECTIONS_READ, db, request)
    org_id = require_org_id(current_user)
    
    # Validate date range
    if report_create.end_date < report_create.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End date must be after start date"
        )
    
    # Get organization
    org_stmt = select(Organization).where(Organization.id == org_id)
    org_result = await db.execute(org_stmt)
    org = org_result.scalar_one_or_none()
    org_name = org.name if org else "PurveX Organization"
    
    # Fetch detections
    detections_stmt = select(Detection).where(
        Detection.organization_id == org_id
    )
    detections_result = await db.execute(detections_stmt)
    detections = detections_result.scalars().all()
    
    # Fetch tests in date range
    tests_stmt = select(Test).where(
        and_(
            Test.organization_id == org_id,
            Test.started_at >= report_create.start_date,
            Test.started_at <= report_create.end_date + timedelta(days=1),
            Test.environment.in_(report_create.environments)
        )
    ).order_by(Test.started_at.desc())
    tests_result = await db.execute(tests_stmt)
    tests = tests_result.scalars().all()
    
    # Convert to dictionaries
    detections_data = [
        {
            "id": d.id,
            "title": d.title,
            "technique_id": d.technique_id,
            "status": d.status,
            "last_result": d.last_result,
            "last_score": d.last_score,
            "last_tested_at": d.last_tested_at.isoformat() if d.last_tested_at else None,
            "last_pass_at": d.last_pass_at.isoformat() if d.last_pass_at else None,
            "last_fail_at": d.last_fail_at.isoformat() if d.last_fail_at else None,
        }
        for d in detections
    ]
    
    tests_data = [
        {
            "id": t.id,
            "detection_id": t.detection_id,
            "technique_id": t.technique_id,
            "environment": t.environment,
            "status": t.status,
            "result": t.result,
            "score": t.score,
            "started_at": t.started_at.isoformat() if t.started_at else None,
            "finished_at": t.finished_at.isoformat() if t.finished_at else None,
        }
        for t in tests
    ]
    
    scoring_stmt = select(DetectionScoring).where(DetectionScoring.organization_id == org_id)
    scoring_result = await db.execute(scoring_stmt)
    scoring = scoring_result.scalar_one_or_none()
    scoring_settings = scoring.__dict__ if scoring else {}

    # Calculate metrics
    health_score = calculate_health_score(detections_data, scoring_settings)
    healthy_count = sum(1 for d in detections_data if derive_health_state(d) == "HEALTHY")
    failed_count = sum(1 for d in detections_data if derive_health_state(d) == "DETECTION_FAILED")
    untested_count = sum(1 for d in detections_data if derive_health_state(d) == "UNKNOWN")
    
    # Get MITRE techniques (simplified - in production, fetch from actual MITRE data)
    # For now, we'll extract from detections
    mitre_techniques = []
    technique_ids_seen = set()
    for d in detections:
        tech_id = d.technique_id
        if tech_id and tech_id not in technique_ids_seen:
            technique_ids_seen.add(tech_id)
            # Extract tactic from technique_id if possible (T1059.003 -> Execution)
            # This is simplified - in production, use actual MITRE data
            mitre_techniques.append({
                "id": tech_id,
                "name": d.title,
                "tactics": ["Execution"],  # Simplified
                "is_subtechnique": "." in tech_id
            })
    
    mitre_coverage = get_mitre_coverage(detections_data, mitre_techniques)
    
    # Generate recommendations
    recommendations = []
    
    # Top failed detections
    failed_detections = [d for d in detections_data if derive_health_state(d) == "DETECTION_FAILED"]
    if failed_detections:
        recommendations.append({
            "title": "Fix Failed Detections",
            "description": f"Address {len(failed_detections)} detections that are failing validation tests.",
            "priority": "High"
        })
    
    # Untested detections
    if untested_count > 0:
        recommendations.append({
            "title": "Validate Untested Detections",
            "description": f"Run validation tests for {untested_count} detections that have never been tested.",
            "priority": "Medium"
        })
    
    # Coverage gaps
    low_coverage_tactics = [
        (tactic, data) for tactic, data in mitre_coverage.items()
        if data.get('total', 0) > 0 and (data.get('validated', 0) / data.get('total', 1)) < 0.5
    ]
    if low_coverage_tactics:
        recommendations.append({
            "title": "Improve ATT&CK Coverage",
            "description": f"Focus on improving coverage for tactics with low validated coverage.",
            "priority": "High"
        })
    
    # Executive takeaways
    executive_takeaways = [
        f"Overall detection health score: {health_score}/100",
        f"{healthy_count} detections are healthy and validated",
        f"{failed_count} detections require immediate attention",
        f"{len(tests_data)} tests executed in the reporting period",
    ]
    
    # Prepare report data
    report_id = str(uuid.uuid4())
    report_data = {
        "report_id": report_id,
        "start_date": report_create.start_date.isoformat(),
        "end_date": report_create.end_date.isoformat(),
        "environments": report_create.environments,
        "generated_at": datetime.utcnow().isoformat(),
        "overall_health_score": health_score,
        "total_detections": len(detections_data),
        "total_tests": len(tests_data),
        "healthy_count": healthy_count,
        "failed_count": failed_count,
        "untested_count": untested_count,
        "detections": detections_data,
        "tests": tests_data,
        "mitre_coverage": mitre_coverage,
        "recommendations": recommendations,
        "executive_takeaways": executive_takeaways,
    }
    
    # Generate PDF
    pdf_filename = f"purvex_report_{report_id}.pdf"
    pdf_path = REPORTS_DIR / pdf_filename
    
    try:
        generate_pdf_report(report_data, str(pdf_path), org_name)
        file_size = pdf_path.stat().st_size
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate PDF: {str(e)}"
        )
    
    # Create report record
    report = Report(
        organization_id=org_id,
        report_id=report_id,
        generated_by=current_user.id,
        start_date=report_create.start_date,
        end_date=report_create.end_date,
        environments=json.dumps(report_create.environments),
        title=report_create.title or f"Detection Effectiveness Report - {report_create.start_date.date()} to {report_create.end_date.date()}",
        overall_health_score=health_score,
        total_detections=len(detections_data),
        total_tests=len(tests_data),
        file_path=str(pdf_path),
        file_size=file_size,
        report_data=json.dumps(report_data)
    )
    
    db.add(report)
    await db.commit()
    await db.refresh(report)
    _ensure_list_environments(report)
    return report


@router.get("/", response_model=List[ReportSchema])
async def list_reports(
    db: DBSession,
    current_user: CurrentUser,
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    """List all reports for the current organization."""
    await require_permission(current_user, Permission.DETECTIONS_READ, db, request)
    org_id = require_org_id(current_user)
    
    stmt = (
        select(Report)
        .where(Report.organization_id == org_id)
        .order_by(Report.generated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    reports = result.scalars().all()
    
    return [_ensure_list_environments(r) for r in reports]


@router.get("/{report_id}/download")
async def download_report(
    report_id: str,
    db: DBSession,
    current_user: CurrentUser,
    request: Request,
):
    """Download a generated PDF report."""
    await require_permission(current_user, Permission.DETECTIONS_READ, db, request)
    org_id = require_org_id(current_user)
    
    stmt = select(Report).where(
        and_(
            Report.report_id == report_id,
            Report.organization_id == org_id
        )
    )
    result = await db.execute(stmt)
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    if not report.file_path or not Path(report.file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report file not found"
        )

    # SECURITY: Prevent path traversal — resolved path must be inside REPORTS_DIR
    resolved = Path(report.file_path).resolve()
    if not resolved.is_relative_to(REPORTS_DIR.resolve()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )

    return FileResponse(
        str(resolved),
        media_type="application/pdf",
        filename=f"purvex_report_{report_id}.pdf"
    )


@router.delete("/{report_id}")
async def delete_report(
    report_id: str,
    db: DBSession,
    current_user: CurrentUser,
    request: Request,
):
    """Delete a report and its associated PDF file."""
    await require_permission(current_user, Permission.DETECTIONS_UPDATE, db, request)
    org_id = require_org_id(current_user)
    
    stmt = select(Report).where(
        and_(
            Report.report_id == report_id,
            Report.organization_id == org_id
        )
    )
    result = await db.execute(stmt)
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    # Delete PDF file if it exists
    if report.file_path and Path(report.file_path).exists():
        try:
            Path(report.file_path).unlink()
        except Exception:
            pass  # Continue even if file deletion fails
    
    # Delete the report record
    await db.execute(
        delete(Report).where(
            Report.id == report.id,
            Report.organization_id == org_id,
        )
    )
    await db.commit()
    
    return {"message": "Report deleted successfully"}
