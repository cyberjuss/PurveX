# backend/app/models.py
import uuid
import json
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, func, UniqueConstraint, Index
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
    is_admin = Column(Boolean, default=False)
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

    # Invite flow: True for accounts created via admin invite that haven't
    # set a password yet. Login is blocked while pending — see auth.py login.
    is_pending_activation = Column(Boolean, default=False, nullable=False)

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


class PasswordResetToken(Base):
    """Track self-service password reset tokens so each token is single-use."""

    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)


class UserInviteToken(Base):
    """Track admin-issued invite tokens so each invite link is single-use.

    Separate table from PasswordResetToken even though the shape is
    identical — invites and resets have different lifecycles (7 days vs 30
    minutes) and different semantics (activates a pending account vs.
    changes an existing password), and keeping them apart avoids a token
    minted for one purpose ever being replayable for the other.
    """

    __tablename__ = "user_invite_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    invited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)


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

    # SIEM sync provenance — set when a detection was pulled from a SIEM
    # rather than authored in PurveX. (siem_connection_id, external_id) is
    # the upsert key for sync; content_hash detects upstream rule drift.
    siem_connection_id = Column(Integer, ForeignKey("siem_connections.id"), nullable=True, index=True)
    external_id = Column(String, nullable=True, index=True)
    content_hash = Column(String, nullable=True)
    # Extended to include "git" (Sprint 3 Detection-as-Code) alongside the
    # existing "manual" and "siem_sync" flavours. The value drives the
    # "source of truth" badge on the detection list and gates who can
    # edit a rule directly vs. via proposal.
    source = Column(String, default="manual")  # "manual" | "siem_sync" | "git"
    enabled_upstream = Column(Boolean, nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    drift_detected_at = Column(DateTime(timezone=True), nullable=True)

    # Git provenance (Sprint 3 DaC). (detection_source_id, source_path) is
    # the upsert key for git sync; content_hash detects upstream drift and
    # drives the drift → proposal path.
    detection_source_id = Column(
        Integer, ForeignKey("detection_sources.id"), nullable=True, index=True
    )
    source_path = Column(String, nullable=True)
    source_commit_sha = Column(String, nullable=True)
    # Snapshot of the YAML payload at last sync (JSON). Used for
    # precise drift detection — live values for these keys are
    # compared directly against this snapshot, avoiding false positives
    # from DB defaults or fields not tracked by DaC.
    source_payload = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Test(Base):
    __tablename__ = "tests"
    __table_args__ = (
        # Hot path: list latest tests for an org (dashboard, tests page).
        Index("ix_tests_org_started_at", "organization_id", "started_at"),
        # Hot path: detection detail -- latest non-telemetry runs per detection.
        Index("ix_tests_detection_mode_started", "detection_id", "mode", "started_at"),
        # Hot path: reconciliation sweep of pending/running tests.
        Index("ix_tests_org_status", "organization_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    detection_id = Column(String, ForeignKey("detections.id"), nullable=True)
    technique_id = Column(String, nullable=False)
    marker = Column(String, nullable=True)
    environment = Column(String, nullable=False)  # "lab", "dev", "prod"
    # Run intent: DETECTION_VALIDATION | ALERT_CHECK | TELEMETRY_CHECK.
    # Drives which scoring path is used by the runner (see atomic_runner.execute_test_pipeline).
    mode = Column(String, nullable=False, default="DETECTION_VALIDATION", server_default="DETECTION_VALIDATION")
    endpoint = Column(String, nullable=True)
    atomic_test_id = Column(String, nullable=True)
    atomic_test_name = Column(String, nullable=True)
    atomic_test_number = Column(Integer, nullable=True)
    initiated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    initiated_by_email = Column(String, nullable=True)
    initiated_by_username = Column(String, nullable=True)
    initiated_by_role = Column(String, nullable=True)
    status = Column(String, nullable=False)  # "pending", "running", "completed", "failed", "qa"
    result = Column(String, nullable=True)  # "pass", "fail", "inconclusive"
    score = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)

    # Snapshot of the detection's rule-defining fields at the moment this Test
    # was created (sha256 over siem_type|technique_id|siem_query|sigma_rule).
    # Drives the per-version KPI rollup so the UI can answer "did my last edit
    # hurt?" Distinct from detections.content_hash, which tracks upstream
    # source-of-truth for drift detection.
    detection_version_hash = Column(String(64), nullable=True)


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


class DetectionSource(Base):
    """A git repository configured as an upstream detection source of truth.

    When a ``DetectionSource`` is synced, each YAML file in ``path_glob``
    becomes a Detection. Changes upstream that conflict with a locally
    modified rule become ``DetectionProposal`` rows with
    ``proposed_by_kind="git"`` so they go through the same approval UI as
    AI proposals (Sprint 2). This is the Detection-as-Code contract: Git
    is the source of truth, PurveX is the runtime.

    V1 assumptions:

    * Git protocol only (HTTPS). SSH is Sprint 4 material.
    * Personal access token lives in ``auth_secret`` encrypted with the
      same Fernet key that protects SIEM credentials (``encrypt_value``).
    * One branch per source row — you model ``main`` + ``staging`` as two
      rows if you need both.
    """

    __tablename__ = "detection_sources"
    __table_args__ = (
        # Settings screens list sources per-org, most-recently-synced first.
        Index(
            "ix_detection_sources_org_synced",
            "organization_id",
            "last_synced_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    name = Column(String, nullable=False)
    provider = Column(String, nullable=False, default="git")
    repo_url = Column(String, nullable=False)
    branch = Column(String, nullable=False, default="main")
    # Glob relative to the repo root. Defaults mirror common DaC layouts.
    path_glob = Column(String, nullable=False, default="detections/**/*.yml")
    # ``auth_type`` ∈ {"none", "token"}. Token flow sends the secret as
    # the Basic-auth password with username "x-access-token" which is the
    # cross-provider idiom (works for GitHub, GitLab, Bitbucket).
    auth_type = Column(String, nullable=False, default="none")
    auth_secret = Column(Text, nullable=True)  # encrypted at rest
    enabled = Column(Boolean, nullable=False, default=True)

    # Sync telemetry. ``last_sync_status`` ∈ {"success", "error"}.
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_status = Column(String, nullable=True)
    last_sync_error = Column(Text, nullable=True)
    last_commit_sha = Column(String, nullable=True)
    last_created_count = Column(Integer, nullable=False, default=0)
    last_updated_count = Column(Integer, nullable=False, default=0)
    last_proposals_count = Column(Integer, nullable=False, default=0)
    last_skipped_count = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=True)


class DetectionProposal(Base):
    """A proposed change to a Detection awaiting human approval.

    The guardrail backbone for AI-assisted remediation: an LLM (or a less
    privileged user) records its intent here, a reviewer with the right RBAC
    scope approves or rejects, and only then does the change land on the
    Detection row. Designed to be reused by Detection-as-Code for git-PR
    approval flow later (Sprint 3) — hence the ``proposed_by_kind`` split
    between "ai" / "user" / "git".

    Status state machine:

        pending ──approve──▶ applied
        pending ──reject──▶  rejected
        pending ──(target drifted)──▶ superseded

    Fields are denormalized (``target_fields`` + ``current_snapshot`` are
    JSON blobs) because proposals are intentionally not ORM-tied to the
    Detection columns — a proposal is meaningful even if its target rule
    was renamed or retired between creation and review.
    """

    __tablename__ = "detection_proposals"
    __table_args__ = (
        # Inbox: list pending proposals for an org, newest first.
        Index("ix_proposals_org_status_created", "organization_id", "status", "created_at"),
        # Detection detail: any pending proposals targeting this rule.
        Index("ix_proposals_detection_status", "detection_id", "status"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)

    # Target — nullable when action=="create" (no existing rule yet).
    # ``ondelete=SET NULL`` so that deleting a Detection doesn't cascade-
    # delete or block on the historical proposal. The approve handler
    # already supersedes when the target row vanishes; the delete service
    # additionally marks pending proposals as superseded so reviewers
    # don't see ghost rows.
    detection_id = Column(
        String, ForeignKey("detections.id", ondelete="SET NULL"), nullable=True
    )

    # Provenance. ``proposed_by_kind`` ∈ {"ai", "user", "git"}. We keep a
    # free-text ``proposed_by_label`` alongside the FK because the AI path
    # doesn't have a User row (e.g. "PurveX Assistant · gpt-4o-mini").
    proposed_by_kind = Column(String, nullable=False, default="ai")
    proposed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    proposed_by_label = Column(String, nullable=False, default="AI Assistant")

    # Shape of the change. ``action`` ∈ {"create", "update", "delete"}.
    action = Column(String, nullable=False, default="update")
    # Status ∈ {"pending", "approved", "rejected", "applied", "superseded"}.
    # "approved" is transitional — we eagerly apply on approval, so callers
    # effectively only observe "applied". Kept separate for forward-compat
    # with an async "approve but defer apply" flow in DaC.
    status = Column(String, nullable=False, default="pending")

    # Free-text reason the AI (or user) gave for the change. Rendered raw
    # on the approval screen so reviewers can sanity-check the logic.
    reason = Column(Text, nullable=True)

    # The partial payload that describes the change: JSON object with only
    # the fields being modified. Kept small and schema-tolerant — we don't
    # want a schema change here every time Detection grows a column.
    target_fields = Column(Text, nullable=False, default="{}")

    # Snapshot of the Detection at proposal time. Used for two things:
    #   1. Computing a before/after diff on review.
    #   2. Detecting drift — if Detection.* has changed since the snapshot
    #      under the proposed fields, the proposal becomes "superseded".
    current_snapshot = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    review_note = Column(Text, nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        # Audit log paging (newest-first) and action filtering.
        Index("ix_audit_events_created_at", "created_at"),
        Index("ix_audit_events_action_created_at", "action", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email = Column(String, nullable=True)
    action = Column(String, nullable=False)
    resource_type = Column(String, nullable=True)
    resource_id = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """A persisted, org-scoped inbox item surfaced on the /notifications page.

    Only covers events with no other durable home — new-runner-connected,
    runner-gone-stale, and proposal-outcome pings. Test/detection activity
    is still derived live from their own tables at read time, so it isn't
    duplicated here.

    ``source_type`` + ``source_id`` let callers dedup: e.g. don't create a
    second "runner went stale" notification for the same runner while an
    earlier one is still unread/undismissed (see
    ``services/notifications.py::notify``).
    """

    __tablename__ = "notifications"
    __table_args__ = (
        Index(
            "ix_notifications_org_source",
            "organization_id", "source_type", "source_id",
        ),
        Index("ix_notifications_org_created_at", "organization_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    type = Column(String, nullable=False, default="platform")
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    action_url = Column(String, nullable=True)
    status = Column(String, nullable=False, default="info")  # success | warning | error | info
    source_type = Column(String, nullable=True)  # "runner_new" | "runner_stale" | "proposal_approved" | ...
    source_id = Column(String, nullable=True)
    extra_metadata = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    read_at = Column(DateTime(timezone=True), nullable=True)
    dismissed_at = Column(DateTime(timezone=True), nullable=True)


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
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_role_org_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    is_system = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    permissions = relationship("Permission", secondary="role_permissions", back_populates="roles")
    user_roles = relationship("UserRole", back_populates="role")


class Permission(Base):
    __tablename__ = "permissions"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_permission_org_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    name = Column(String, nullable=False, index=True)
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

    # Git audit mirror. When set, every ``sync-detections`` run writes
    # the serialized YAML of each created/updated/proposed detection to
    # the linked ``DetectionGitMirror`` repo as one commit per sync.
    # This is how SIEM-owned rules get a full, reviewable change history
    # in Git without making Git the source of truth for authoring.
    audit_mirror_id = Column(
        Integer, ForeignKey("detection_git_mirrors.id"), nullable=True, index=True
    )
    audit_mirror_enabled = Column(Boolean, nullable=False, default=False)


class DetectionGitMirror(Base):
    """A git repository PurveX *writes to* to mirror SIEM-owned detections.

    Distinct from ``DetectionSource`` (which PurveX *reads from*). The
    mirror is the compliance/audit artifact: every SIEM-side change to a
    rule becomes a git commit here, so auditors and change-management
    reviewers get full "who/what/when" without touching PurveX or the
    SIEM directly.

    Ownership semantics
    -------------------
    * A mirror is **output-only** from PurveX's perspective. We never
      read rules back from it — that's what ``DetectionSource`` is for.
    * One ``SIEMConnection`` maps to at most one mirror. Multiple SIEM
      connections can share a mirror (they'll write to different path
      subtrees via ``path_template``).
    * Commits are authored by a bot identity (configurable). The audit
      value comes from the commit message body, which embeds the SIEM
      change metadata (who changed it upstream, when, which fields).

    V1 assumptions
    --------------
    * HTTPS only (same as ``DetectionSource``).
    * Personal access token in ``auth_secret``, Fernet-encrypted at rest.
    * Write mode ∈ {``"direct"``, ``"branch"``, ``"pr"``} — see
      ``git_writeback.py``. V1 defaults to ``"direct"`` (fast audit log).
    """

    __tablename__ = "detection_git_mirrors"
    __table_args__ = (
        Index(
            "ix_detection_git_mirrors_org_mirrored",
            "organization_id",
            "last_mirrored_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    name = Column(String, nullable=False)
    repo_url = Column(String, nullable=False)
    branch = Column(String, nullable=False, default="main")

    # Per-detection path template. Tokens: ``{siem}``, ``{technique_id}``,
    # ``{external_id}``, ``{slug}``. Default puts each SIEM in its own
    # subtree so diffs stay clean even with multiple connections.
    path_template = Column(
        String,
        nullable=False,
        default="detections/{siem}/{technique_id}/{slug}.yml",
    )

    # Commit author identity used when this service pushes.
    commit_author_name = Column(String, nullable=False, default="PurveX Bot")
    commit_author_email = Column(
        String, nullable=False, default="purvex-bot@purvex.local"
    )

    # ``direct`` = push straight to ``branch``. ``branch`` = push to a
    # timestamped audit branch (never touches main). ``pr`` = push to a
    # feature branch and open a PR via the provider API (GitHub today).
    write_mode = Column(String, nullable=False, default="direct")

    # Auth. Matches ``DetectionSource`` shape for symmetry.
    auth_type = Column(String, nullable=False, default="none")
    auth_secret = Column(Text, nullable=True)  # Fernet-encrypted

    enabled = Column(Boolean, nullable=False, default=True)

    # Telemetry on the last publish run.
    last_mirrored_at = Column(DateTime(timezone=True), nullable=True)
    last_mirror_status = Column(String, nullable=True)  # success | error
    last_mirror_error = Column(Text, nullable=True)
    last_commit_sha = Column(String, nullable=True)
    last_commits_count = Column(Integer, nullable=False, default=0)
    last_files_written = Column(Integer, nullable=False, default=0)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(DateTime(timezone=True), nullable=True)


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
    ssh_host_key_sha256 = Column(String, nullable=True)
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
    owner_name = Column(String, nullable=True)
    owner_email = Column(String, nullable=True)
    # Bind a runner to the SIEM that actually receives its host's telemetry.
    # The atomic runner uses this to validate against the right SIEM and
    # refuses to run synced detections from a different connection.
    siem_connection_id = Column(Integer, ForeignKey("siem_connections.id"), nullable=True, index=True)


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
    retention_pass_days_lab = Column(Integer, default=7)
    retention_fail_days_lab = Column(Integer, default=30)
    retention_pass_days_dev = Column(Integer, default=30)
    retention_fail_days_dev = Column(Integer, default=90)
    retention_pass_days_prod = Column(Integer, default=90)
    retention_fail_days_prod = Column(Integer, default=180)


class DetectionScoring(Base):
    __tablename__ = "detection_scorings"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    base_scoring_explanation = Column(
        Text,
        default=(
            "Score = last test score if available. If not, use base scores "
            "(PASS 80, FAIL 30, INCONCLUSIVE 50). Recent tests weigh more "
            "than stale tests."
        ),
    )
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
    provider = Column(String, default="Built-in")
    model_name = Column(String, default="")
    api_base_url = Column(String, default="")
    api_key = Column(Text, nullable=True)  # Encrypted in production
    generate_tuning_suggestions = Column(Boolean, default=True)
    explain_test_failures = Column(Boolean, default=True)
    max_tokens = Column(Integer, default=2000)
    temperature = Column(Integer, default=7)  # 0-10 scale
    analysis_mode = Column(String, default="fast")


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


class Job(Base):
    """Durable record of a background job enqueued to the worker.

    Tracks lifecycle independently of the underlying queue so the UI can show
    status, attempts, and failure reason even if the queue driver is flushed
    or the in-process fallback is used. Paired with arq when REDIS_URL is set.
    """

    __tablename__ = "jobs"
    __table_args__ = (
        # Worker reconciliation / dashboards scan running+queued jobs fast.
        Index("ix_jobs_status_enqueued_at", "status", "enqueued_at"),
        # Per-tenant job views.
        Index("ix_jobs_org_enqueued_at", "organization_id", "enqueued_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    job_type = Column(String, nullable=False, index=True)  # e.g. "test_execution"
    resource_type = Column(String, nullable=True)  # e.g. "test"
    resource_id = Column(String, nullable=True, index=True)  # e.g. test id
    status = Column(String, nullable=False, default="pending", index=True)
    # pending | queued | running | success | failed | timeout | cancelled
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    last_error = Column(Text, nullable=True)
    arq_job_id = Column(String, nullable=True, index=True)
    enqueued_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
