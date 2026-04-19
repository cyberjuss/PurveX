from __future__ import annotations

import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..routers.auth import get_current_user
from ..config import settings
from ..db import get_db
from ..services.ai_assistant import call_llm
from ..utils.tenant import require_org_id
from sqlalchemy import select, desc, func
from .. import models


router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantRequest(BaseModel):
  """Request body for the Watchtower /assistant/chat endpoint."""

  # Full prompt we want to send to the LLM. In a future iteration we can
  # extend this with structured fields like `alert`, `detection`, `test`, etc.
  prompt: Optional[str] = Field(None, description="User message to send to the LLM.")
  action: Optional[str] = Field(None, description="Action ID for structured Watchtower analysis.")
  context_scope: Optional[Literal["portfolio", "detection"]] = Field(
    None,
    description="Whether to prepend portfolio or detection-specific PurveX context to a freeform prompt.",
  )
  detection_id: Optional[str] = None
  alert_id: Optional[int] = None
  force_demo: Optional[bool] = False
  model_name: Optional[str] = Field(None, description="Optional model override for this request.")


class AssistantResponse(BaseModel):
  """Simple wrapper for the LLM's answer text."""

  answer: str


MAX_PROMPT_CHARS = 10000  # Basic guard against extremely large prompts.

ACTION_TEMPLATES: dict[str, str] = {
  "portfolio_health": (
    "You are Watchtower for PurveX. Use the Portfolio Context to answer.\n"
    "Format:\n"
    "Summary: 2-3 sentences.\n"
    "Findings:\n- bullet\n- bullet\n"
    "Root cause: choose one of LOGGING_PIPELINE | RULE_LOGIC | FIELD_MISMATCH | THRESHOLDING | OTHER (confidence: low|medium|high)\n"
    "Next steps:\n1) step\n2) step\n3) step\n"
  ),
  "coverage_gaps": (
    "Identify top coverage gaps from Portfolio Context.\n"
    "Format: Summary, Findings (2 bullets), Root cause, Next steps (1-3)."
  ),
  "coverage_improve": (
    "Recommend the top 3 coverage improvements based on Portfolio Context.\n"
    "Format: Summary, Findings (2 bullets), Root cause, Next steps (1-3)."
  ),
  "detection_summary": (
    "Summarize the detection and latest test outcome. Keep it concise.\n"
    "Format: Summary, Findings (2 bullets), Root cause, Next steps (1-3)."
  ),
  "test_explain": (
    "Explain the latest test result and why it passed/failed. Identify missing telemetry if any.\n"
    "Format: Summary, Findings (2 bullets), Root cause, Next steps (1-3)."
  ),
  "fix_recommendations": (
    "Provide concrete fixes to improve this detection and how to validate.\n"
    "Format: Summary, Findings (2 bullets), Root cause, Next steps (1-3)."
  ),
  "alert_explain": (
    "Explain the selected alert/event and recommended actions.\n"
    "Format: Summary, Findings (2 bullets), Root cause, Next steps (1-3)."
  ),
}

STATIC_DEMO_CONTEXT = (
  "[Portfolio Context]\n"
  "Total detections: 12\n"
  "Total tests: 24\n"
  "Pass rate: 62%\n"
  "Recent techniques: T1059.001, T1021.001, T1110, T1003\n"
  "Recent tests: 241:T1059.001:PASS, 240:T1021.001:FAIL, 239:T1110:INCONCLUSIVE\n"
  "Recent failing tests: 240:T1021.001:FAIL, 239:T1110:INCONCLUSIVE\n"
  "\n[Detection Context]\n"
  "Title: PowerShell Command Execution\n"
  "MITRE Technique: T1059.001\n"
  "SIEM Type: splunk\n"
  "Status: ACTIVE\n"
  "Description: Detects suspicious PowerShell execution patterns.\n"
  "SIEM Query:\nindex=windows EventCode=4104 (ScriptBlockText=\"*EncodedCommand*\" OR ScriptBlockText=\"*ExecutionPolicy Bypass*\")\n"
  "Latest Test Run:\n- Test ID: 241\n- Started: 2026-01-25T10:30:00Z\n- Environment: lab\n- Status: completed\n- Result: FAIL\n- Score: 45\n"
)

def _truncate(value: Optional[str], max_len: int) -> str:
  if not value:
    return ""
  if len(value) <= max_len:
    return value
  return value[:max_len] + "\n... (truncated)"

async def _build_portfolio_context(db, org_id: int) -> str:
  det_count = (await db.execute(select(func.count()).select_from(models.Detection).where(models.Detection.organization_id == org_id))).scalar() or 0
  test_count = (await db.execute(select(func.count()).select_from(models.Test).where(models.Test.organization_id == org_id))).scalar() or 0
  pass_count = (await db.execute(
    select(func.count()).select_from(models.Test)
    .where(models.Test.organization_id == org_id, models.Test.result == "PASS")
  )).scalar() or 0
  pass_rate = int(round((pass_count / test_count) * 100)) if test_count else 0

  recent_tests_result = await db.execute(
    select(models.Test)
    .where(models.Test.organization_id == org_id)
    .order_by(desc(models.Test.started_at))
    .limit(5)
  )
  recent_tests = recent_tests_result.scalars().all()
  recent_test_lines = [
    f"{t.id}:{t.technique_id}:{t.result or t.status or 'UNKNOWN'}"
    for t in recent_tests
  ]
  recent_techniques = list(dict.fromkeys([t.technique_id for t in recent_tests if t.technique_id]))[:5]

  failing_tests_result = await db.execute(
    select(models.Test)
    .where(models.Test.organization_id == org_id)
    .order_by(desc(models.Test.started_at))
    .limit(10)
  )
  failing_tests = [
    t for t in failing_tests_result.scalars().all()
    if (t.result or t.status) and (t.result or t.status) != "PASS"
  ][:5]
  failing_lines = [f"{t.id}:{t.technique_id}:{t.result or t.status or 'UNKNOWN'}" for t in failing_tests]

  return (
    "[Portfolio Context]\n"
    f"Total detections: {det_count}\n"
    f"Total tests: {test_count}\n"
    f"Pass rate: {pass_rate}%\n"
    f"Recent techniques: {', '.join(recent_techniques) if recent_techniques else 'Not available'}\n"
    f"Recent tests: {', '.join(recent_test_lines) if recent_test_lines else 'None'}\n"
    f"Recent failing tests: {', '.join(failing_lines) if failing_lines else 'None'}\n"
  )

async def _build_detection_context(db, org_id: int, detection_id: Optional[str]) -> str:
  if not detection_id:
    # fall back to most recent detection with a test
    detection_result = await db.execute(
      select(models.Detection)
      .where(models.Detection.organization_id == org_id)
      .limit(1)
    )
    detection = detection_result.scalars().first()
  else:
    detection_result = await db.execute(
      select(models.Detection)
      .where(models.Detection.organization_id == org_id, models.Detection.id == detection_id)
    )
    detection = detection_result.scalars().first()

  if not detection:
    return ""

  # Prefer tests tied to the detection; fallback to tests matching technique_id.
  test_result = await db.execute(
    select(models.Test)
    .where(
      models.Test.organization_id == org_id,
      (models.Test.detection_id == detection.id) | (models.Test.technique_id == detection.technique_id),
    )
    .order_by(desc(models.Test.started_at))
    .limit(1)
  )
  latest_test = test_result.scalars().first()

  artifact = None
  if latest_test:
    art_result = await db.execute(
      select(models.TestArtifact)
      .where(models.TestArtifact.organization_id == org_id, models.TestArtifact.test_id == latest_test.id)
      .limit(1)
    )
    artifact = art_result.scalars().first()

  context = (
    "[Detection Context]\n"
    f"Title: {detection.title}\n"
    f"MITRE Technique: {detection.technique_id}\n"
    f"SIEM Type: {detection.siem_type}\n"
    f"Status: {detection.status or 'DRAFT'}\n"
  )
  if detection.description:
    context += f"Description: {_truncate(detection.description, 600)}\n"
  if detection.siem_query:
    context += f"SIEM Query:\n{_truncate(detection.siem_query, 2000)}\n"
  if detection.sigma_rule:
    context += f"Sigma Rule:\n{_truncate(detection.sigma_rule, 2000)}\n"
  if latest_test:
    context += (
      "Latest Test Run:\n"
      f"- Test ID: {latest_test.id}\n"
      f"- Started: {latest_test.started_at}\n"
      f"- Environment: {latest_test.environment}\n"
      f"- Status: {latest_test.status}\n"
      f"- Result: {latest_test.result or latest_test.status}\n"
      f"- Score: {latest_test.score if latest_test.score is not None else 'N/A'}\n"
    )
  if artifact and artifact.siem_sample_events:
    context += f"Sample Events:\n{_truncate(artifact.siem_sample_events, 1500)}\n"
  return context

async def _build_alert_context(db, org_id: int, alert_id: Optional[int]) -> str:
  if not alert_id:
    return ""

  alert_result = await db.execute(
    select(models.DetectionAlert).where(
      models.DetectionAlert.organization_id == org_id,
      models.DetectionAlert.id == alert_id,
    )
  )
  alert = alert_result.scalar_one_or_none()
  if not alert:
    return ""

  context = (
    "[Alert Context]\n"
    f"Alert ID: {alert.id}\n"
    f"Name: {alert.name}\n"
    f"Severity: {alert.severity}\n"
    f"Time: {alert.time}\n"
  )
  if alert.host:
    context += f"Host: {alert.host}\n"
  if alert.query:
    context += f"Alert Query:\n{_truncate(alert.query, 1200)}\n"
  if alert.raw_event:
    context += f"Raw Event:\n{_truncate(alert.raw_event, 1200)}\n"
  if alert.test_id:
    context += f"Linked Test ID: {alert.test_id}\n"
  return context

def _fallback_action_response(action: Optional[str], context: str) -> str:
  # Minimal, deterministic fallback used when no external AI provider is enabled.
  lines = context.splitlines()
  total_det = next((l.split(": ", 1)[1] for l in lines if l.startswith("Total detections: ")), "Not provided")
  total_tests = next((l.split(": ", 1)[1] for l in lines if l.startswith("Total tests: ")), "Not provided")
  pass_rate = next((l.split(": ", 1)[1] for l in lines if l.startswith("Pass rate: ")), "Not provided")
  failing = next((l.split(": ", 1)[1] for l in lines if l.startswith("Recent failing tests: ")), "Not provided")
  title = next((l.split(": ", 1)[1] for l in lines if l.startswith("Title: ")), "Detection")
  result = next((l.split(": ", 1)[1] for l in lines if l.startswith("- Result: ")), "Not provided")

  summary = (
    f"Summary: Portfolio has {total_det} detections and {total_tests} tests with a pass rate of {pass_rate}."
    if action in {"portfolio_health", "coverage_gaps", "coverage_improve"}
    else f"Summary: {title} latest test result is {result}."
  )
  findings = [
    f"- Recent failing tests: {failing}",
    "- Review telemetry coverage and query logic for failures.",
  ]
  root = "Root cause: OTHER (confidence: low)"
  steps = [
    "1) Verify required telemetry is enabled for key techniques.",
    "2) Re-run the latest test after any fixes.",
    "3) Update detection queries or field mappings if needed.",
  ]
  return "\n".join([summary, "Findings:"] + findings + [root, "Next steps:"] + steps)

async def _build_demo_context(db, org_id: int) -> str:
  portfolio = await _build_portfolio_context(db, org_id)
  detection = await _build_detection_context(db, org_id, None)
  if portfolio or detection:
    return f"{portfolio}\n{detection}".strip()
  return os.getenv("PURVEX_DEMO_CONTEXT") or STATIC_DEMO_CONTEXT


WATCHTOWER_SYSTEM_PROMPT = os.getenv(
  "WATCHTOWER_SYSTEM_PROMPT",
  """
You are PurveX AI Watchtower, a detection engineering assistant.

Your role: Analyze security detections, explain test results (PASS/FAIL/INCONCLUSIVE),
and suggest improvements to SPL queries and Sigma rules.

You will often be given a [Detection Context] block that looks like:

  [Detection Context]
  Title: <detection title>
  MITRE Technique: <technique id, e.g. T1003>
  SIEM Type: <siem type>
  Status: <lifecycle status>
  SIEM Query used for this detection:
  <SPL / query text>

  Latest Test Run:
  - Test ID: <id>
  - Started: <timestamp>
  - Environment: <env, e.g. LAB or PROD>
  - Status: <status>
  - Result: <result>
  - Score: <0–100 or N/A>

When this context is present, you MUST:
1. Start your answer with a single line header:

   <Title> · <MITRE Technique> · <Environment>

   - Use the values from Title, MITRE Technique, and Environment (from Latest Test Run).
   - If a value is missing, simply omit that part instead of guessing.

2. Ground ALL analysis strictly in the provided context:
   - Do NOT invent thresholds, log-source variability, or field names that were not given.
   - If you are unsure or data is missing, say "Not provided in context" instead of speculating.

3. Use the following response format:
   - Summary: 2–3 sentences describing what was tested and the overall outcome.
   - Technical findings: up to 3 bullet points that reference ONLY fields, queries,
     rules, and results explicitly present in the context.
   - Root cause: one of RULE_LOGIC | FIELD_MISMATCH | LOGGING_PIPELINE | THRESHOLDING | OTHER,
     plus a confidence label in parentheses: (confidence: low | medium | high).
   - Improved queries/rules: only when you can safely edit the provided query or rule.
   - Recommendations: up to 3 numbered items with clear, concrete next steps for the detection engineer.

4. Style and tone:
   - Be concise and technical.
   - Use SOC/detection-engineering terminology.
   - Never invent data or behavior that is not present in the prompt.
   - Prefer small, targeted improvements over large rewrites unless clearly necessary.
""".strip(),
)

ACTION_SYSTEM_PROMPT = os.getenv(
  "WATCHTOWER_ACTION_SYSTEM_PROMPT",
  "You are PurveX Watchtower. Follow the requested format exactly and keep answers concise."
)

def _action_system_prompt() -> str:
  return f"{ACTION_SYSTEM_PROMPT}\n\n{PURVEX_KNOWLEDGE_PACK}"


def _configured_ai_settings(ai_settings: Optional[models.AIAssistantSettings]) -> tuple[str, str, str]:
  provider = (getattr(ai_settings, "provider", None) or settings.AI_PROVIDER or "OpenAI").strip()
  model_name = (getattr(ai_settings, "model_name", None) or settings.OPENAI_MODEL).strip()
  api_base_url = (getattr(ai_settings, "api_base_url", None) or settings.OPENAI_API_BASE_URL).strip()
  return provider, model_name, api_base_url


def _provider_key_hint(provider: str) -> str:
  provider_l = (provider or "").strip().lower()
  if provider_l == "deepseek":
    return "DEEPSEEK_API_KEY (or OPENAI_API_KEY compatibility variable)"
  return "OPENAI_API_KEY"


async def _load_ai_settings(db, org_id: int) -> Optional[models.AIAssistantSettings]:
  result = await db.execute(
    select(models.AIAssistantSettings).where(models.AIAssistantSettings.organization_id == org_id)
  )
  return result.scalar_one_or_none()

PURVEX_KNOWLEDGE_PACK = """
You are PurveX Watchtower, a focused detection-engineering assistant.

PurveX glossary:
- Goal template: predefined objective + scope for a test campaign.
- TTP: MITRE technique/sub-technique identifier (e.g., T1059.001).
- Environment: lab/dev/prod target where tests run.
- Runner/Agent: execution component that runs tests in an environment.
- Test mode: validation flow (e.g., coverage validation vs. explore).
- Required telemetry: log sources/fields needed to validate a detection.
- Evidence pack: exportable proof bundle (test metadata + events + outcome).
- Coverage gap: a detection lacks recent PASS or required telemetry.
- Retest loop: fix → re-run → verify outcome.

PurveX concepts:
- Detection: a detection definition (SPL or Sigma) mapped to a MITRE technique.
- Test: an executed validation run (often Atomic Red Team) that checks telemetry and detection logic.
- Test Artifact: captured command, sample SIEM events, and AI notes.
- Results: PASS = detection logic matched expected telemetry, FAIL = detection logic missed expected telemetry, INCONCLUSIVE = telemetry missing or insufficient.
- Coverage gap: a detection exists but fails or has no recent PASS in the target environment.

PurveX goals:
- Validate coverage per technique and environment.
- Identify missing telemetry vs. flawed detection logic.
- Provide clear, actionable next steps and retest guidance.

Telemetry expectations (typical):
- Process creation, authentication, network, file, registry.

Output rules:
- Use only provided context (do not invent hosts, fields, thresholds, or telemetry).
- If data is missing, say "Not provided in context."
""".strip()


@router.post("/chat", response_model=AssistantResponse)
async def chat_with_assistant(
  payload: AssistantRequest,
  user = Depends(get_current_user),
  db = Depends(get_db),
) -> AssistantResponse:
  """Return a Watchtower answer using the configured AI provider with deterministic fallback."""
  # SECURITY: Sanitize prompt input
  from ..utils.security import sanitize_string
  if not payload.prompt and not payload.action:
    raise HTTPException(status_code=400, detail="Prompt or action is required.")

  sanitized_prompt = sanitize_string(payload.prompt or "", max_length=MAX_PROMPT_CHARS)
  action = payload.action
  if not sanitized_prompt and not action:
    raise HTTPException(status_code=400, detail="Prompt cannot be empty")
  
  org_id = require_org_id(user)
  ai_settings = await _load_ai_settings(db, org_id)
  provider, model_name, api_base_url = _configured_ai_settings(ai_settings)
  requested_model = (payload.model_name or "").strip()
  if requested_model:
    # Keep a strict allowlist for per-request model override.
    allowed_models = {"gpt-4o-mini", "gpt-4o", "deepseek-chat", "deepseek-reasoner"}
    if requested_model not in allowed_models:
      raise HTTPException(status_code=400, detail=f"Unsupported model: {requested_model}")
    model_name = requested_model

  # Build context pack when action is provided (preferred MVP path).
  if action:
    if payload.force_demo:
      context = await _build_demo_context(db, org_id)
    else:
      if action in {"portfolio_health", "coverage_gaps", "coverage_improve"}:
        context = await _build_portfolio_context(db, org_id)
      else:
        context = await _build_detection_context(db, org_id, payload.detection_id)
      if not context:
        raise HTTPException(status_code=404, detail="Requested context is not available for this workspace.")
    action_prompt = ACTION_TEMPLATES.get(action, "")
    sanitized_prompt = (
      f"{action_prompt}\n"
      f"{context}\n"
      f"[User Question]\n{payload.prompt or action}\n"
    )

  # Simple size limit to prevent extremely large prompts from overloading the LLM.
  if len(sanitized_prompt) > MAX_PROMPT_CHARS:
    raise HTTPException(
      status_code=400,
      detail=f"Prompt is too long ({len(sanitized_prompt)} characters). Please shorten the question or narrow the context.",
    )

  if action:
    answer = call_llm(
      sanitized_prompt,
      system_prompt=_action_system_prompt(),
      provider=provider,
      api_base_url=api_base_url,
      model_name=model_name,
      timeout_seconds=20,
    )
    if answer.startswith("Error communicating"):
      answer = _fallback_action_response(action, sanitized_prompt)
    return AssistantResponse(answer=answer)

  freeform_context = ""
  if payload.force_demo:
    freeform_context = await _build_demo_context(db, org_id)
  elif payload.context_scope == "portfolio":
    freeform_context = await _build_portfolio_context(db, org_id)
  elif payload.context_scope == "detection" or payload.detection_id or payload.alert_id:
    detection_context = await _build_detection_context(db, org_id, payload.detection_id)
    alert_context = await _build_alert_context(db, org_id, payload.alert_id)
    freeform_context = "\n".join(part for part in [detection_context, alert_context] if part).strip()

  if freeform_context:
    sanitized_prompt = (
      f"{freeform_context}\n"
      "[User Question]\n"
      f"{sanitized_prompt}"
    )

  answer = call_llm(
    sanitized_prompt,
    system_prompt=WATCHTOWER_SYSTEM_PROMPT,
    provider=provider,
    api_base_url=api_base_url,
    model_name=model_name,
    timeout_seconds=20,
  )
  if answer.startswith("Error communicating"):
    key_hint = _provider_key_hint(provider)
    answer = (
      "Summary: AI analysis is unavailable right now.\n"
      "Findings:\n"
      f"- Provider: {provider}\n"
      f"- Model: {model_name}\n"
      f"- Error: {answer}\n"
      "Root cause: OTHER (confidence: high)\n"
      "Next steps:\n"
      f"1) Confirm {key_hint} is configured on the backend.\n"
      "2) Verify the selected model and API base URL are valid.\n"
      "3) Retry the request after updating AI assistant settings."
    )
  return AssistantResponse(answer=answer)
