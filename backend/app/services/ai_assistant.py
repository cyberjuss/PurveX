import json
import logging
from typing import AsyncIterator, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from .. import models
from ..config import settings


logger = logging.getLogger(__name__)


# Hardcoded baseline of provider hosts we ship support for. Customers who
# need a different host (Azure OpenAI, a self-hosted vLLM, etc.) widen the
# allowlist via PURVEX_LLM_ALLOWED_HOSTS in their env, never via the per-org
# settings page — that page collects untrusted user input.
_BUILTIN_LLM_HOSTS = frozenset({"api.openai.com", "api.deepseek.com"})


def _llm_allowed_hosts() -> frozenset[str]:
    extra = (getattr(settings, "LLM_EXTRA_ALLOWED_HOSTS", "") or "").strip()
    if not extra:
        return _BUILTIN_LLM_HOSTS
    extras = {h.strip().lower() for h in extra.split(",") if h.strip()}
    return _BUILTIN_LLM_HOSTS | frozenset(extras)


def validate_llm_base_url(api_base_url: Optional[str]) -> None:
    """Reject base URLs that could be used to redirect LLM traffic to internal
    services. Raises ValueError on anything that isn't an https:// URL whose
    host is in the configured allowlist. ``None`` means "use the default" and
    is always allowed.
    """
    if not api_base_url:
        return
    parsed = urlparse(api_base_url.strip())
    if parsed.scheme != "https":
        raise ValueError("LLM base URL must use https://")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("LLM base URL is missing a hostname")
    if host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}:
        raise ValueError("LLM base URL must not point at a loopback address")
    allowed = _llm_allowed_hosts()
    if host not in allowed:
        raise ValueError(
            "LLM base URL host is not in the allowlist; "
            "add it to PURVEX_LLM_ALLOWED_HOSTS to permit it"
        )


def _resolve_provider(provider: Optional[str]) -> tuple[str, str]:
    """Returns (normalized_provider, human_label). Raises ValueError on unsupported."""
    resolved = (provider or settings.AI_PROVIDER or "OpenAI").strip().lower()
    if resolved in {"built-in", "builtin"}:
        raise ValueError("Built-in provider does not support external model calls.")
    if resolved not in {"openai", "deepseek"}:
        raise ValueError("provider not supported")
    label = "DeepSeek" if resolved == "deepseek" else "OpenAI"
    return resolved, label


def _resolve_endpoint(
    provider: str,
    api_base_url: Optional[str],
    model_name: Optional[str],
) -> tuple[str, str]:
    """Returns (full_chat_completions_url, resolved_model)."""
    default_base_url = (
        "https://api.deepseek.com/v1"
        if provider == "deepseek"
        else settings.OPENAI_API_BASE_URL
    )
    base_url = (api_base_url or default_base_url).rstrip("/")
    resolved_model = model_name or (
        "deepseek-chat" if provider == "deepseek" else settings.OPENAI_MODEL
    )
    return f"{base_url}/chat/completions", resolved_model


async def stream_llm(
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    provider: Optional[str] = None,
    api_base_url: Optional[str] = None,
    model_name: Optional[str] = None,
    timeout_seconds: int = 30,
) -> AsyncIterator[str]:
    """Yield content deltas from the configured chat-completions provider.

    The stream is wire-compatible with both OpenAI and DeepSeek (both emit
    SSE lines of the form ``data: {...}\\n\\n`` with a final ``data: [DONE]``).

    Errors are raised — callers wrap and surface them to the SSE client.
    """
    try:
        resolved_provider, label = _resolve_provider(provider)
    except ValueError as exc:
        raise RuntimeError(f"Error communicating with AI provider: {exc}") from exc

    try:
        validate_llm_base_url(api_base_url)
    except ValueError as exc:
        # Treat as a configuration error rather than a transient upstream
        # failure so callers can surface it to the operator.
        raise RuntimeError(f"Refusing to call LLM: {exc}") from exc

    api_key = settings.OPENAI_API_KEY
    if not api_key:
        raise RuntimeError(f"Error communicating with {label}: API key is not configured.")

    url, resolved_model = _resolve_endpoint(resolved_provider, api_base_url, model_name)
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        async with client.stream(
            "POST",
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            json={
                "model": resolved_model,
                "messages": messages,
                "temperature": 0.2,
                "stream": True,
            },
        ) as response:
            if response.status_code >= 400:
                # Drain the body so we can include a useful diagnostic in
                # logs without leaking it to the client.
                body_bytes = await response.aread()
                logger.warning(
                    "LLM upstream HTTP error: provider=%s status=%s body=%s",
                    label, response.status_code, body_bytes[:1000],
                )
                raise RuntimeError(
                    f"Error communicating with {label}: upstream returned status {response.status_code}."
                )

            async for line in response.aiter_lines():
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload or payload == "[DONE]":
                    if payload == "[DONE]":
                        return
                    continue
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if isinstance(content, str) and content:
                    yield content


def call_llm(
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    provider: Optional[str] = None,
    api_base_url: Optional[str] = None,
    model_name: Optional[str] = None,
    timeout_seconds: int = 10,
) -> str:
    resolved_provider = (provider or settings.AI_PROVIDER or "OpenAI").strip().lower()
    if resolved_provider not in {"openai", "deepseek", "built-in", "builtin"}:
        return "Error communicating with AI provider: provider not supported."

    if resolved_provider in {"built-in", "builtin"}:
        return "Error communicating with AI provider: Built-in provider does not support external model calls."

    label = "DeepSeek" if resolved_provider == "deepseek" else "OpenAI"

    try:
        validate_llm_base_url(api_base_url)
    except ValueError as exc:
        return f"Refusing to call {label}: {exc}"

    api_key = settings.OPENAI_API_KEY
    if not api_key:
        return f"Error communicating with {label}: API key is not configured."

    default_base_url = "https://api.deepseek.com/v1" if resolved_provider == "deepseek" else settings.OPENAI_API_BASE_URL
    base_url = (api_base_url or default_base_url).rstrip("/")
    resolved_model = model_name or ("deepseek-chat" if resolved_provider == "deepseek" else settings.OPENAI_MODEL)
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": resolved_model,
                    "messages": messages,
                    "temperature": 0.2,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        # Log the upstream body server-side for diagnostics, but never echo it
        # to the client — provider error bodies can include request IDs, model
        # internals, or partial credentials.
        logger.warning(
            "LLM upstream HTTP error: provider=%s status=%s body=%s",
            label, exc.response.status_code, exc.response.text[:1000],
        )
        return f"Error communicating with {label}: upstream returned status {exc.response.status_code}."
    except Exception as exc:
        logger.warning("LLM upstream call failed: provider=%s error=%s", label, exc)
        return f"Error communicating with {label}: upstream request failed."

    choices = payload.get("choices") or []
    if not choices:
        return f"Error communicating with {label}: No choices returned."

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()

    return f"Error communicating with {label}: Empty response content."

def _provider_unavailable_analysis() -> Dict:
    return {
        "ai_explanation": (
            "AI analysis was not generated because the configured provider is unavailable or not "
            "configured. No synthetic fallback analysis was stored for this test."
        ),
        "ai_suggested_rule": None,
        "ai_root_cause_category": "OTHER",
        "ai_confidence_score": 0,
    }


def analyze_detection(
    test: models.Test,
    detection: models.Detection,
    events_sample: List[Dict],
    ai_settings: Optional[models.AIAssistantSettings] = None,
) -> Dict:
    """Analyzes a detection test result using the AI assistant.
    """
    # Optionally scrub sensitive fields (IPs, hostnames, usernames) before
    # sending events to the LLM, based on configuration.
    scrubbed_events = events_sample
    if settings.STRIP_IPS_HOSTNAMES:
        scrubbed_events = []
        sensitive_keys = {
            "ip", "ip_address", "src_ip", "dst_ip", "source_ip", "destination_ip",
            "dest_ip", "host", "hostname", "computer_name", "user", "username",
            "account", "account_name", "principal"
        }
        for ev in events_sample:
            if not isinstance(ev, dict):
                scrubbed_events.append(ev)
                continue
            clone = ev.copy()
            for key in list(clone.keys()):
                if key.lower() in sensitive_keys:
                    clone[key] = "[REDACTED]"
            scrubbed_events.append(clone)

    mode = (getattr(ai_settings, "analysis_mode", None) or "fast").lower()
    if mode == "deep":
        max_events = 10
        timeout_seconds = 25
    elif mode == "balanced":
        max_events = 6
        timeout_seconds = 15
    else:
        max_events = 3
        timeout_seconds = 10

    limited_events = scrubbed_events[:max_events]
    events_str = json.dumps(limited_events, indent=2)

    # Prompt is intentionally concrete and workflow-aware so the AI behaves like
    # a senior detection engineer reviewing a PurveX Watchtower run, not a
    # generic chatbot.
    prompt = f"""
You are PurveX Watchtower AI, a senior detection engineer.

You are given a single PurveX detection validation test run. Your job is to:
- Understand the end-to-end workflow (atomic test → SIEM telemetry → detection rule firing or not).
- Read the sample SIEM events carefully and extract concrete facts (technique, host, user, command line, timestamps, etc.).
- Decide why the test result is PASS / FAIL / INCONCLUSIVE based on evidence, not generic guesses.
- Suggest very specific, actionable tuning for the detection rule when appropriate.

Always ground your reasoning in the actual fields and values from the events and the SIEM query. Avoid generic phrases like "as an AI model" or "in today's cybersecurity landscape". Do not repeat the prompt back to me.

=== CONTEXT ===
Detection Title: {detection.title}
Detection Technique ID: {detection.technique_id}
SIEM Query: {detection.siem_query}
Environment: {getattr(test, "environment", "unknown")}
Test Result: {test.result}
Test Score: {test.score}
Marker: {test.marker}
Started At: {test.started_at}
Finished At: {test.finished_at}

Sample SIEM Events (already pre-filtered for this test):
```json
{events_str}
```

Interpret PASS / FAIL / INCONCLUSIVE as:
- PASS: Logs are present and the rule fired correctly for this atomic test.
- FAIL: Logs are present but the rule did not fire or clearly missed key behavior.
- INCONCLUSIVE: Logs are missing, clearly malformed, or the data is insufficient to decide.

=== REQUIRED OUTPUT FORMAT ===

Explanation:
- Start with 1–2 sentences summarising what was executed (technique, high-level behavior).
- Then describe what telemetry you actually see in the sample events (hosts, users, key fields, timestamps).
- Explicitly state why the test outcome (PASS/FAIL/INCONCLUSIVE) makes sense based on those events.
- End with 2–3 concise next steps for the detection engineer (what to adjust, validate, or monitor next).

Suggested Rule:
```rule
Provide either:
- A refined or alternative SIEM query / rule body tailored to this data (including relevant fields and technique ID), OR
- The exact text: No changes suggested. (only if the detection clearly works well and you see no meaningful improvements).
Keep this section tightly focused on practical query/rule syntax, not prose.
```

Root Cause Category: Choose ONE of:
- RULE_LOGIC (query is too loose/too strict, wrong conditions, missing filters, etc.)
- ENVIRONMENT (logging not enabled, agents misconfigured, data never reaches SIEM, etc.)
- ATOMIC_TEST_ISSUE (the atomic did not run as expected, wrong parameters, or test is not representative)
- SIEM_CONFIGURATION (index/source/category routing, parsing, field extractions, RBAC, etc.)
- FALSE_POSITIVE (rule fires on benign activity and needs refinement)
- OTHER (anything that does not clearly fit the above)

Confidence: An integer from 0 to 100 representing how confident you are in your explanation and root cause.
"""

    llm_response = call_llm(
        prompt,
        provider=getattr(ai_settings, "provider", None),
        api_base_url=getattr(ai_settings, "api_base_url", None),
        model_name=getattr(ai_settings, "model_name", None),
        timeout_seconds=timeout_seconds,
    )

    if not llm_response or llm_response.startswith("Error communicating"):
        return _provider_unavailable_analysis()

    # Parse the LLM response
    ai_explanation = ""
    ai_suggested_rule = ""
    ai_root_cause_category = "OTHER"
    ai_confidence_score = 0

    # Simple parsing - this could be more robust with regex or a dedicated parsing library
    if "Explanation:" in llm_response:
        parts = llm_response.split("Suggested Rule:")
        ai_explanation = parts[0].replace("Explanation:", "").strip()
        
        if len(parts) > 1:
            rule_parts = parts[1].split("Root Cause Category:")
            if "```rule" in rule_parts[0] and "```" in rule_parts[0]:
                ai_suggested_rule = rule_parts[0].split("```rule")[1].split("```")[0].strip()
            
            if len(rule_parts) > 1:
                category_parts = rule_parts[1].split("Confidence:")
                ai_root_cause_category = category_parts[0].strip()
                if len(category_parts) > 1:
                    try:
                        ai_confidence_score = int(category_parts[1].strip())
                    except ValueError:
                        pass # Keep default if parsing fails

    return {
        "ai_explanation": ai_explanation,
        "ai_suggested_rule": ai_suggested_rule,
        "ai_root_cause_category": ai_root_cause_category,
        "ai_confidence_score": ai_confidence_score,
    }
