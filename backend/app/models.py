# backend/app/models.py
import uuid
import json
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, func, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime

from .db import Base


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    primary_contact_email = Column(String, nullable=True)
    timezone = Column(String, default="UTC")
    locale = Column(String, default="en_US")
    default_environment_names = Column(Text, default='["lab", "dev", "prod"]')  # JSON string
    compliance_mode_flags = Column(Text, default='[]')  # JSON string
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=True)
    # org-level scoping for multi‑tenant deployments. All per-tenant data
    # (detections/tests/etc.) is associated with this organization.
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # SECURITY: Account lockout fields
    # Note: nullable=True initially to support migration; migration will set defaults
    failed_login_attempts = Column(Integer, default=0, nullable=True)
    locked_until = Column(DateTime(timezone=True), nullable=True)  # Account locked until this time
    
    # SECURITY: 2FA fields
    two_factor_enabled = Column(Boolean, default=False, nullable=False)
    two_factor_secret = Column(String, nullable=True)  # TOTP secret key (encrypted in production)
    two_factor_backup_codes = Column(Text, nullable=True)  # JSON array of backup codes
    
    # RBAC: User roles relationship
    user_roles = relationship("UserRole", back_populates="user", foreign_keys="UserRole.user_id")
    password_history = relationship("PasswordHistory", back_populates="user", cascade="all, delete-orphan")


class PasswordHistory(Base):
    """
    Track a limited history of password hashes per user to prevent reuse
    of recently-used passwords.
    """
    __tablename__ = "password_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="password_history")


class Detection(Base):
    __tablename__ = "detections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    technique_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    sigma_rule = Column(Text, nullable=True)
    siem_type = Column(String, nullable=False)
    siem_query = Column(Text, nullable=False)
    scheduled = Column(Boolean, default=False)
    
    # Test result fields (denormalized for performance)
    last_result = Column(String, nullable=True)
    last_score = Column(Integer, nullable=True)
    last_tested_at = Column(DateTime(timezone=True), nullable=True)
    last_pass_at = Column(DateTime(timezone=True), nullable=True)
    last_fail_at = Column(DateTime(timezone=True), nullable=True)
    last_alert_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=True)
    last_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    owner = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    
    # RBAC: Criticality field
    criticality = Column(String, default="MEDIUM")  # LOW, MEDIUM, HIGH, CRITICAL
    
    # Lifecycle tracking
    lifecycle_stage = Column(String, default="identify")
    stage_changed_at = Column(DateTime(timezone=True), nullable=True)
    stage_changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Test(Base):
    __tablename__ = "tests"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=True)
    technique_id = Column(String, nullable=False)
    marker = Column(String, nullable=True)
    environment = Column(String, nullable=False)  # "lab", "dev", "prod"
    endpoint = Column(String, nullable=True)
    initiated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    initiated_by_email = Column(String, nullable=True)
    initiated_by_username = Column(String, nullable=True)
    initiated_by_role = Column(String, nullable=True)
    status = Column(String, nullable=False)  # "pending", "running", "completed", "failed", "qa"
    result = Column(String, nullable=True)  # "pass", "fail", "inconclusive"
    score = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class TestArtifact(Base):
    __tablename__ = "test_artifacts"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    test_id = Column(Integer, ForeignKey("tests.id"), nullable=False)
    atomic_command = Column(Text, nullable=True)
    siem_sample_events = Column(Text, nullable=True)
    ai_explanation = Column(Text, nullable=True)
    ai_suggested_rule = Column(Text, nullable=True)
    ai_root_cause_category = Column(String, default="OTHER")
    ai_confidence_score = Column(Integer, default=0)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email = Column(String, nullable=True)
    action = Column(String, nullable=False)
    resource_type = Column(String, nullable=True)
    resource_id = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    report_id = Column(String, unique=True, nullable=False, index=True)  # UUID for external reference
    generated_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Report parameters
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=False)
    environments = Column(Text, nullable=False)  # JSON array: ["lab", "dev", "prod"]
    
    # Report metadata
    title = Column(String, nullable=False)
    overall_health_score = Column(Integer, nullable=True)  # 0-100
    total_detections = Column(Integer, nullable=False, default=0)
    total_tests = Column(Integer, nullable=False, default=0)
    
    # Storage
    file_path = Column(String, nullable=True)  # Path to stored PDF file
    file_size = Column(Integer, nullable=True)  # Size in bytes
    
    # Report data (JSON snapshot for reference)
    report_data = Column(Text, nullable=True)  # JSON string with full report data


# RBAC Models

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    is_system = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    permissions = relationship("Permission", secondary="role_permissions", back_populates="roles")
    user_roles = relationship("UserRole", back_populates="role")


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    category = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    roles = relationship("Role", secondary="role_permissions", back_populates="permissions")


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id = Column(Integer, ForeignKey("roles.id"), primary_key=True)
    permission_id = Column(Integer, ForeignKey("permissions.id"), primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)


class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    user = relationship("User", foreign_keys=[user_id], back_populates="user_roles")
    role = relationship("Role", back_populates="user_roles")
    
    # Unique constraint: one role per user per org
    __table_args__ = (
        UniqueConstraint('user_id', 'role_id', 'organization_id', name='uq_user_role_org'),
    )


# Settings Models

class SIEMConnection(Base):
    __tablename__ = "siem_connections"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    siem_type = Column(String, nullable=False)
    name = Column(String, nullable=False)
    url = Column(String, nullable=False)
    auth_type = Column(String, nullable=False)
    credentials = Column(Text, nullable=True)  # Encrypted in production
    last_validated_at = Column(DateTime(timezone=True), nullable=True)
    default_windows_index = Column(String, nullable=True)
    default_linux_index = Column(String, nullable=True)
    default_cloud_index = Column(String, nullable=True)
    log_marker_pattern = Column(String, default="purvex_*")


class EnvironmentRunnerConfig(Base):
    __tablename__ = "environment_runner_configs"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    environment_name = Column(String, nullable=False)
    runner_type = Column(String, default="SSH")
    hostname = Column(String, nullable=True)
    port = Column(Integer, default=22)
    username = Column(String, nullable=True)
    auth_method = Column(String, default="key")
    key_path = Column(String, nullable=True)
    allowed_test_types = Column(Text, default='["Atomic only"]')  # JSON string
    max_concurrent_tests = Column(Integer, default=1)
    heartbeat_interval_seconds = Column(Integer, default=5)
    alert_offline_minutes = Column(Integer, default=5)
    os = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    agent_version = Column(String, nullable=True)
    last_check_in = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=True)
    runner_token_hash = Column(String, nullable=True)
    runner_token_last_rotated_at = Column(DateTime(timezone=True), nullable=True)
    runner_token_expires_at = Column(DateTime(timezone=True), nullable=True)


class AgentCommand(Base):
    __tablename__ = "agent_commands"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    runner_id = Column(Integer, ForeignKey("environment_runner_configs.id"), nullable=False, index=True)
    command_type = Column(String, nullable=False)
    status = Column(String, default="pending", index=True)
    payload = Column(Text, nullable=True)
    message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    issued_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

class AgentRegistrationToken(Base):
    __tablename__ = "agent_registration_tokens"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    issued_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    used_by_runner_id = Column(Integer, ForeignKey("environment_runner_configs.id"), nullable=True)


class TestingPolicy(Base):
    __tablename__ = "testing_policies"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    allowed_environments = Column(Text, default='["lab", "dev"]')  # JSON string
    default_marker_prefix = Column(String, default="purvex_")
    include_env_timestamp_in_marker = Column(Boolean, default=True)
    tag_test_alerts = Column(String, default="Purvex_Test = true")
    notify_before_prod_tests = Column(Boolean, default=False)
    disallow_tests_during_business_hours = Column(Boolean, default=False)
    business_hours_start = Column(String, default="09:00")
    business_hours_end = Column(String, default="17:00")
    only_prod_during_maintenance_windows = Column(Boolean, default=False)
    test_data_retention_days = Column(Integer, default=90)


class DetectionScoring(Base):
    __tablename__ = "detection_scorings"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    base_scoring_explanation = Column(Text, default="PASS with logs → base 80, FAIL with logs → base 30, INCONCLUSIVE → base 50")
    pass_log_base_score = Column(Integer, default=80)
    fail_log_base_score = Column(Integer, default=30)
    inconclusive_base_score = Column(Integer, default=50)
    recent_pass_fail_weight = Column(Integer, default=10)
    false_positive_penalty = Column(Integer, default=10)
    environment_penalty_discount = Column(Integer, default=0)
    health_threshold_healthy = Column(Integer, default=80)
    health_threshold_at_risk = Column(Integer, default=50)
    health_threshold_critical = Column(Integer, default=20)
    scoring_window_n_tests = Column(Integer, default=10)


class AIAssistantSettings(Base):
    __tablename__ = "ai_assistant_settings"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    provider = Column(String, default="Local LLaMA")
    model_name = Column(String, default="llama3.1")
    api_base_url = Column(String, default="http://localhost:11434")
    api_key = Column(Text, nullable=True)  # Encrypted in production
    generate_tuning_suggestions = Column(Boolean, default=True)
    explain_test_failures = Column(Boolean, default=True)
    max_tokens = Column(Integer, default=2000)
    temperature = Column(Integer, default=7)  # 0-10 scale


class SandboxEnvironment(Base):
    __tablename__ = "sandbox_environments"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    external_id = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    status = Column(String, nullable=False)  # "provisioning", "ready", "error"
    size = Column(String, nullable=True)  # "small", "medium", "large"
    provider = Column(String, nullable=True)  # "purvex_stub", "aws", "azure", etc.
    extra_metadata = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TestSchedule(Base):
    __tablename__ = "test_schedules"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=True)
    technique_id = Column(String, nullable=True)
    environment = Column(String, nullable=False)  # "lab", "dev", "prod"
    mode = Column(String, default="DETECTION_VALIDATION")
    schedule_type = Column(String, nullable=False)  # "once", "interval", "cron"
    run_at = Column(DateTime(timezone=True), nullable=True)  # For "once" schedules
    interval_seconds = Column(Integer, nullable=True)  # For "interval" schedules
    cron_expression = Column(String, nullable=True)  # For "cron" schedules
    enabled = Column(Boolean, default=True, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)  # When to run next
