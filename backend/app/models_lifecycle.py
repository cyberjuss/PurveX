# backend/app/models_lifecycle.py
"""
Detection Engineering Lifecycle Models
Extended models for full lifecycle support
"""
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, func
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from .db import Base


class ThreatIntelSource(Base):
    """
    IDENTIFY Phase: Document WHY we're building this detection
    Links detection to threat intelligence, incidents, or compliance requirements
    """
    __tablename__ = "threat_intel_sources"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=False)

    # SOURCE INFORMATION
    source_type = Column(String, nullable=False)
    # Options: "incident", "threat_report", "cve", "compliance", "red_team", "threat_intel", "user_request"

    source_reference = Column(String, nullable=True)
    # ticket ID, CVE number, report URL, compliance framework reference

    source_description = Column(Text, nullable=True)
    # Brief description of the threat/requirement

    # THREAT CONTEXT
    threat_actor = Column(String, nullable=True)  # APT29, Lazarus, FIN7, etc.
    malware_family = Column(String, nullable=True)  # Mimikatz, Cobalt Strike, etc.
    campaign_name = Column(String, nullable=True)  # SolarWinds, Colonial Pipeline, etc.

    # BUSINESS CONTEXT
    industry_relevance = Column(String, nullable=True)  # finance, healthcare, retail, government
    business_risk = Column(String, nullable=True)  # "HIGH: Targets domain controllers"
    affected_assets = Column(Text, nullable=True)  # JSON: ["domain_controllers", "databases", "endpoints"]

    # PRIORITIZATION
    priority_score = Column(Integer, default=50)  # 1-100 (AI can calculate this)
    urgency = Column(String, default="medium")  # low, medium, high, critical

    # METADATA
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # RELATIONSHIPS
    detection = relationship("Detection", back_populates="intel_sources")
    creator = relationship("User", foreign_keys=[created_by])


class DetectionDesign(Base):
    """
    DESIGN Phase: The 'spec' for a detection before building it
    Documents design decisions, requirements, and expected behavior
    """
    __tablename__ = "detection_designs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=False)

    # DETECTION HYPOTHESIS
    hypothesis = Column(Text, nullable=False)
    # "If attacker performs lateral movement via PsExec, we'll see RemoteServiceCreation events"

    # REQUIRED LOG SOURCES
    required_log_sources = Column(Text, nullable=False)
    # JSON: ["windows_security", "sysmon", "edr", "netflow"]

    required_fields = Column(Text, nullable=False)
    # JSON: ["EventCode", "ServiceName", "CommandLine", "ParentImage", "User"]

    # DETECTION LOGIC
    detection_method = Column(String, nullable=False)
    # Options: "correlation", "threshold", "anomaly", "signature", "behavioral", "statistical"

    logic_description = Column(Text, nullable=True)
    # "Alert if 3+ failed login attempts from same IP within 5 minutes"

    # FALSE POSITIVE SCENARIOS
    false_positive_scenarios = Column(Text, nullable=True)
    # JSON: ["IT admin activity", "Automated scripts", "Monitoring tools"]

    false_positive_mitigation = Column(Text, nullable=True)
    # "Exclude service accounts matching pattern svc_*"

    # SUCCESS CRITERIA
    expected_fidelity = Column(String, default="medium")
    # Options: "high" (<1% FP), "medium" (1-5% FP), "low" (>5% FP)

    expected_tpp = Column(String, nullable=True)  # Time to Process
    # "< 2 minutes", "< 5 minutes", "< 15 minutes"

    expected_coverage = Column(String, nullable=True)
    # "Detects 80%+ of PsExec lateral movement techniques"

    # AI-GENERATED INSIGHTS
    ai_design_review = Column(Text, nullable=True)
    # AI analysis of the design quality and feasibility

    ai_suggested_improvements = Column(Text, nullable=True)
    # AI recommendations for improving the design

    ai_risk_assessment = Column(Text, nullable=True)
    # AI-identified risks with this design

    # PEER REVIEW
    review_requested_at = Column(DateTime, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    review_status = Column(String, default="pending")  # pending, approved, rejected, needs_revision
    review_comments = Column(Text, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    # METADATA
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)

    # RELATIONSHIPS
    detection = relationship("Detection", back_populates="design_docs")
    creator = relationship("User", foreign_keys=[created_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


class DetectionVersion(Base):
    """
    DEVELOP Phase: Track every change to a detection rule
    Git-like version control for detection queries
    """
    __tablename__ = "detection_versions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=False)
    version_number = Column(Integer, nullable=False)  # auto-increment per detection

    # THE RULE ITSELF
    siem_query = Column(Text, nullable=False)
    sigma_rule = Column(Text, nullable=True)

    # CHANGE DOCUMENTATION
    change_summary = Column(String, nullable=False)
    # "Fixed FP by excluding admin accounts", "Initial version", "Tuned threshold from 5 to 10"

    change_type = Column(String, nullable=False)
    # Options: "initial", "tuning", "bugfix", "refactor", "optimization", "rollback"

    change_reason = Column(Text, nullable=True)
    # "AI suggestion from test #123", "Manual tuning after production FP", "Peer review feedback"

    # VALIDATION
    validated_by_test = Column(Boolean, default=False)
    validation_test_id = Column(Integer, ForeignKey("tests.id"), nullable=True)
    validation_result = Column(String, nullable=True)  # PASS, FAIL, INCONCLUSIVE

    # VERSION CONTROL
    is_active = Column(Boolean, default=False)  # Only one version active at a time
    parent_version_id = Column(Integer, ForeignKey("detection_versions.id"), nullable=True)
    # Links to previous version for diff tracking

    # METADATA
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # RELATIONSHIPS
    detection = relationship("Detection", back_populates="versions")
    validation_test = relationship("Test", foreign_keys=[validation_test_id])
    creator = relationship("User", foreign_keys=[created_by])
    parent_version = relationship("DetectionVersion", remote_side=[id], foreign_keys=[parent_version_id])


class DetectionDeployment(Base):
    """
    DEPLOY Phase: Track every deployment to production SIEM
    Maintains deployment history and rollback capability
    """
    __tablename__ = "detection_deployments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=False)
    version_id = Column(Integer, ForeignKey("detection_versions.id"), nullable=False)

    # WHERE
    target_environment = Column(String, nullable=False)  # "prod", "prod-west", "prod-eu"
    siem_connection_id = Column(Integer, ForeignKey("siem_connections.id"), nullable=True)

    # DEPLOYMENT SETTINGS
    deployment_method = Column(String, default="api")
    # Options: "manual", "api", "terraform", "ansible", "ui"

    deployment_status = Column(String, default="pending")
    # Options: "pending", "in_progress", "success", "failed", "rolled_back"

    deployment_error = Column(Text, nullable=True)  # Error message if failed

    # SIEM-SPECIFIC METADATA
    siem_rule_id = Column(String, nullable=True)  # e.g., Splunk correlation search ID
    siem_rule_name = Column(String, nullable=True)
    siem_schedule = Column(String, nullable=True)  # Cron expression: "*/5 * * * *"

    # DEPLOYMENT CONFIGURATION
    alert_priority = Column(String, default="medium")  # low, medium, high, critical
    notification_channels = Column(Text, nullable=True)  # JSON: ["slack", "email", "pagerduty"]
    throttling_enabled = Column(Boolean, default=True)
    throttling_window = Column(String, nullable=True)  # "5m", "1h", "1d"

    # APPROVAL WORKFLOW
    approval_required = Column(Boolean, default=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_notes = Column(Text, nullable=True)

    # TIMING
    deployed_at = Column(DateTime, nullable=True)
    deployed_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # ROLLBACK
    rolled_back_at = Column(DateTime, nullable=True)
    rolled_back_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    rollback_reason = Column(Text, nullable=True)

    # RELATIONSHIPS
    detection = relationship("Detection", back_populates="deployment_history")
    version = relationship("DetectionVersion")
    deployer = relationship("User", foreign_keys=[deployed_by])
    approver = relationship("User", foreign_keys=[approved_by])


class MaintenanceLog(Base):
    """
    MAINTAIN Phase: Track all maintenance activities on a detection
    Captures drift, tuning, incidents, and operational changes
    """
    __tablename__ = "maintenance_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=False)

    # EVENT CLASSIFICATION
    event_type = Column(String, nullable=False)
    # Options: "drift_detected", "tuned", "disabled", "enabled", "escalated",
    #          "deprecated", "lifecycle_transition", "fp_spike", "tp_spike", "threshold_adjusted"

    event_severity = Column(String, default="info")  # info, warning, error, critical

    event_description = Column(Text, nullable=False)
    # "FP rate increased from 2% to 8% over last 7 days"

    # METRICS SNAPSHOT (at time of event)
    metric_snapshot = Column(Text, nullable=True)
    # JSON: {
    #   "fp_rate": 8.2,
    #   "tp_count": 12,
    #   "score": 65,
    #   "avg_detection_time": "3m",
    #   "alert_volume_7d": 45
    # }

    # ACTION TAKEN
    action_taken = Column(String, nullable=True)
    # "Increased threshold from 5 to 10", "Added exclusion for service accounts", "Disabled until investigation"

    action_result = Column(String, nullable=True)  # "success", "failed", "pending"

    # AUTOMATION
    automated = Column(Boolean, default=False)  # Was this AI-automated or manual?
    ai_recommendation = Column(Text, nullable=True)  # AI-suggested action

    # FOLLOW-UP
    requires_follow_up = Column(Boolean, default=False)
    follow_up_deadline = Column(DateTime, nullable=True)
    follow_up_assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)

    # METADATA
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # RELATIONSHIPS
    detection = relationship("Detection", back_populates="maintenance_logs")
    creator = relationship("User", foreign_keys=[created_by])
    assignee = relationship("User", foreign_keys=[follow_up_assigned_to])


class DetectionDeprecation(Base):
    """
    Track deprecated detections and reasons
    Maintains institutional knowledge about what didn't work and why
    """
    __tablename__ = "detection_deprecations"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=False)

    # DEPRECATION REASON
    deprecation_reason = Column(String, nullable=False)
    # Options: "no_longer_relevant", "too_many_fps", "replaced_by_better_detection",
    #          "log_source_unavailable", "business_requirement_changed", "never_triggered"

    detailed_explanation = Column(Text, nullable=True)
    # Full explanation of why this detection was deprecated

    replacement_detection_id = Column(String, ForeignKey("detections.id"), nullable=True)
    # If replaced by another detection, link it

    # STATISTICS AT DEPRECATION
    total_triggers = Column(Integer, default=0)
    true_positives = Column(Integer, default=0)
    false_positives = Column(Integer, default=0)
    days_in_production = Column(Integer, default=0)

    # LESSONS LEARNED
    lessons_learned = Column(Text, nullable=True)
    # What we learned from this detection's lifecycle

    ai_summary = Column(Text, nullable=True)
    # AI-generated summary of detection's effectiveness

    # METADATA
    deprecated_at = Column(DateTime(timezone=True), server_default=func.now())
    deprecated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # RELATIONSHIPS
    detection = relationship("Detection", foreign_keys=[detection_id])
    replacement = relationship("Detection", foreign_keys=[replacement_detection_id])
    deprecator = relationship("User", foreign_keys=[deprecated_by])


# ENHANCE EXISTING DETECTION MODEL
# Add these fields to existing Detection class in models.py:
"""
# LIFECYCLE TRACKING
lifecycle_stage = Column(String, default="identify")
# Options: "identify", "design", "develop", "test", "deploy", "maintain", "deprecated"

stage_changed_at = Column(DateTime, default=datetime.utcnow)
stage_changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)

# TESTING REQUIREMENTS (for deployment gates)
min_test_runs_before_deploy = Column(Integer, default=3)
required_test_environments = Column(Text, default='["lab"]')  # JSON
test_coverage_met = Column(Boolean, default=False)

# DEPLOYMENT APPROVAL
deployment_approved = Column(Boolean, default=False)
approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
approved_at = Column(DateTime, nullable=True)

# PRODUCTION METRICS (maintained during MAINTAIN phase)
production_since = Column(DateTime, nullable=True)
last_true_positive = Column(DateTime, nullable=True)
last_false_positive = Column(DateTime, nullable=True)
total_production_triggers = Column(Integer, default=0)
estimated_fp_rate = Column(Integer, nullable=True)  # percentage 0-100

# NEW RELATIONSHIPS
intel_sources = relationship("ThreatIntelSource", back_populates="detection")
design_docs = relationship("DetectionDesign", back_populates="detection")
versions = relationship("DetectionVersion", back_populates="detection")
deployment_history = relationship("DetectionDeployment", back_populates="detection")
maintenance_logs = relationship("MaintenanceLog", back_populates="detection")
"""
