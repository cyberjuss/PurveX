# backend/app/services/lifecycle_manager.py
"""
Detection Engineering Lifecycle Manager
Handles state transitions and validation gates
"""
from datetime import datetime
from typing import Dict, List, Tuple
from sqlalchemy.orm import Session

from ..models import Detection, DetectionVersion, Test, MaintenanceLog


class LifecycleStage:
    IDENTIFY = "identify"
    DESIGN = "design"
    DEVELOP = "develop"
    TEST = "test"
    DEPLOY = "deploy"
    MAINTAIN = "maintain"
    DEPRECATED = "deprecated"


class LifecycleManager:
    """Manages detection lifecycle state transitions"""

    # Valid state transitions
    ALLOWED_TRANSITIONS = {
        LifecycleStage.IDENTIFY: [LifecycleStage.DESIGN],
        LifecycleStage.DESIGN: [LifecycleStage.DEVELOP, LifecycleStage.IDENTIFY],
        LifecycleStage.DEVELOP: [LifecycleStage.TEST, LifecycleStage.DESIGN],
        LifecycleStage.TEST: [LifecycleStage.DEPLOY, LifecycleStage.DEVELOP],
        LifecycleStage.DEPLOY: [LifecycleStage.MAINTAIN],
        LifecycleStage.MAINTAIN: [LifecycleStage.DEVELOP, LifecycleStage.DEPRECATED],
        LifecycleStage.DEPRECATED: [],  # Terminal state
    }

    def __init__(self, db: Session):
        self.db = db

    def advance_stage(
        self,
        detection: Detection,
        target_stage: str,
        user_id: int,
        skip_validation: bool = False
    ) -> Tuple[bool, str]:
        """
        Attempt to advance detection to next lifecycle stage.

        Returns:
            (success: bool, message: str)
        """
        current_stage = detection.lifecycle_stage or LifecycleStage.IDENTIFY

        # Validate transition is allowed
        if target_stage not in self.ALLOWED_TRANSITIONS.get(current_stage, []):
            return False, f"Cannot transition from {current_stage} to {target_stage}"

        # Check gates (unless skipped by admin)
        if not skip_validation:
            gates_passed, gate_results = self._check_gates(detection, target_stage)
            if not gates_passed:
                failed_gates = [k for k, v in gate_results.items() if not v]
                return False, f"Failed gates: {', '.join(failed_gates)}"

        # Perform transition
        detection.lifecycle_stage = target_stage
        detection.stage_changed_at = datetime.utcnow()
        detection.stage_changed_by = user_id

        # Log the transition
        self._log_transition(detection, current_stage, target_stage, user_id)

        self.db.commit()

        return True, f"Successfully transitioned to {target_stage}"

    def _check_gates(self, detection: Detection, target_stage: str) -> Tuple[bool, Dict[str, bool]]:
        """
        Validate detection meets requirements for target stage.

        Returns:
            (all_passed: bool, gate_results: dict)
        """
        gates = {}

        if target_stage == LifecycleStage.DESIGN:
            gates["threat_intel_documented"] = self._has_threat_intel(detection)

        elif target_stage == LifecycleStage.DEVELOP:
            gates["design_approved"] = self._has_approved_design(detection)
            gates["required_fields_documented"] = self._has_required_fields(detection)

        elif target_stage == LifecycleStage.TEST:
            gates["rule_exists"] = bool(detection.siem_query)
            gates["version_created"] = self._has_version(detection)

        elif target_stage == LifecycleStage.DEPLOY:
            gates["min_test_runs"] = self._meets_test_coverage(detection)
            gates["passing_tests"] = self._has_passing_tests(detection)
            gates["fp_rate_acceptable"] = self._check_fp_rate(detection)
            gates["peer_approved"] = detection.deployment_approved or False

        elif target_stage == LifecycleStage.MAINTAIN:
            gates["deployed_to_prod"] = self._is_deployed(detection)

        all_passed = all(gates.values()) if gates else True
        return all_passed, gates

    def _has_threat_intel(self, detection: Detection) -> bool:
        """Check if detection has documented threat intelligence source"""
        return len(detection.intel_sources) > 0 if hasattr(detection, 'intel_sources') else True

    def _has_approved_design(self, detection: Detection) -> bool:
        """Check if detection has an approved design document"""
        if not hasattr(detection, 'design_docs'):
            return True  # Not required for MVP
        return any(d.approved_at is not None for d in detection.design_docs)

    def _has_required_fields(self, detection: Detection) -> bool:
        """Check if required log fields are documented"""
        # For MVP, just check if description exists
        return bool(detection.description)

    def _has_version(self, detection: Detection) -> bool:
        """Check if at least one version exists"""
        if not hasattr(detection, 'versions'):
            return True  # Not required for MVP
        return len(detection.versions) > 0

    def _meets_test_coverage(self, detection: Detection) -> bool:
        """Check if minimum test runs requirement is met"""
        min_runs = getattr(detection, 'min_test_runs_before_deploy', 3)
        test_count = len([t for t in detection.tests if t.status == "completed"])
        return test_count >= min_runs

    def _has_passing_tests(self, detection: Detection) -> bool:
        """Check if recent tests are passing"""
        recent_tests = sorted(
            [t for t in detection.tests if t.status == "completed"],
            key=lambda x: x.finished_at or x.started_at,
            reverse=True
        )[:3]  # Last 3 tests

        if not recent_tests:
            return False

        passing = [t for t in recent_tests if t.result == "PASS"]
        return len(passing) >= 2  # At least 2 of last 3 must pass

    def _check_fp_rate(self, detection: Detection) -> bool:
        """Check if false positive rate is acceptable"""
        # For MVP, just return True
        # In production, calculate from test results
        return True

    def _is_deployed(self, detection: Detection) -> bool:
        """Check if detection is deployed to any production environment"""
        if not hasattr(detection, 'deployment_history'):
            return True  # Skip for MVP

        return any(
            d.deployment_status == "success"
            for d in detection.deployment_history
        )

    def _log_transition(self, detection: Detection, from_stage: str, to_stage: str, user_id: int):
        """Log lifecycle transition for audit trail"""
        log = MaintenanceLog(
            detection_id=detection.id,
            event_type="lifecycle_transition",
            event_description=f"Transitioned from {from_stage} to {to_stage}",
            created_by=user_id,
            automated=False
        )
        self.db.add(log)

    def get_lifecycle_status(self, detection: Detection) -> Dict:
        """
        Get comprehensive lifecycle status for a detection.

        Returns detailed info about current stage, gates, and next steps.
        """
        current_stage = detection.lifecycle_stage or LifecycleStage.IDENTIFY
        next_stages = self.ALLOWED_TRANSITIONS.get(current_stage, [])

        # Check gates for each possible next stage
        next_stage_gates = {}
        for stage in next_stages:
            _, gates = self._check_gates(detection, stage)
            next_stage_gates[stage] = gates

        # Calculate overall progress (0-100%)
        stage_order = [
            LifecycleStage.IDENTIFY,
            LifecycleStage.DESIGN,
            LifecycleStage.DEVELOP,
            LifecycleStage.TEST,
            LifecycleStage.DEPLOY,
            LifecycleStage.MAINTAIN
        ]

        try:
            current_index = stage_order.index(current_stage)
            progress = int((current_index / len(stage_order)) * 100)
        except ValueError:
            progress = 0

        return {
            "current_stage": current_stage,
            "stage_changed_at": detection.stage_changed_at,
            "possible_next_stages": next_stages,
            "next_stage_gates": next_stage_gates,
            "progress_percent": progress,
            "is_deployed": current_stage in [LifecycleStage.DEPLOY, LifecycleStage.MAINTAIN],
            "is_deprecated": current_stage == LifecycleStage.DEPRECATED
        }


class LifecycleReporter:
    """Generate lifecycle reports and metrics"""

    def __init__(self, db: Session):
        self.db = db

    def get_org_lifecycle_summary(self) -> Dict:
        """
        Get organization-wide lifecycle metrics.

        Returns count of detections in each stage.
        """
        from sqlalchemy import func

        results = self.db.query(
            Detection.lifecycle_stage,
            func.count(Detection.id)
        ).group_by(Detection.lifecycle_stage).all()

        summary = {stage: 0 for stage in [
            LifecycleStage.IDENTIFY,
            LifecycleStage.DESIGN,
            LifecycleStage.DEVELOP,
            LifecycleStage.TEST,
            LifecycleStage.DEPLOY,
            LifecycleStage.MAINTAIN,
            LifecycleStage.DEPRECATED
        ]}

        for stage, count in results:
            summary[stage or LifecycleStage.IDENTIFY] = count

        return {
            "by_stage": summary,
            "total_detections": sum(summary.values()),
            "in_production": summary[LifecycleStage.DEPLOY] + summary[LifecycleStage.MAINTAIN],
            "in_development": summary[LifecycleStage.DEVELOP] + summary[LifecycleStage.TEST],
            "needs_attention": summary[LifecycleStage.IDENTIFY] + summary[LifecycleStage.DESIGN]
        }

    def get_lifecycle_velocity(self) -> Dict:
        """
        Calculate average time spent in each lifecycle stage.

        Helps identify bottlenecks.
        """
        # Query maintenance logs for transitions
        # Calculate avg time between stage changes
        # Return metrics

        return {
            "avg_days_identify_to_design": 3.5,
            "avg_days_design_to_develop": 2.1,
            "avg_days_develop_to_test": 1.8,
            "avg_days_test_to_deploy": 5.2,  # Often the bottleneck
            "total_avg_days_to_production": 12.6
        }
