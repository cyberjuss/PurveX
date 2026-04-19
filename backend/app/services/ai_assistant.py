import json
from typing import Dict, List, Optional

import httpx

from .. import models
from ..config import settings


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
        return f"Error communicating with AI provider: Unsupported provider '{provider}'."

    if resolved_provider in {"built-in", "builtin"}:
        return "Error communicating with AI provider: Built-in provider does not support external model calls."

    api_key = settings.OPENAI_API_KEY
    if not api_key:
        if resolved_provider == "deepseek":
            return "Error communicating with DeepSeek: OPENAI_API_KEY is not configured."
        return "Error communicating with OpenAI: OPENAI_API_KEY is not configured."

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
        error_detail = exc.response.text.strip()
        label = "DeepSeek" if resolved_provider == "deepseek" else "OpenAI"
        return f"Error communicating with {label}: {exc.response.status_code} {error_detail}"
    except Exception as exc:
        label = "DeepSeek" if resolved_provider == "deepseek" else "OpenAI"
        return f"Error communicating with {label}: {exc}"

    choices = payload.get("choices") or []
    if not choices:
        label = "DeepSeek" if resolved_provider == "deepseek" else "OpenAI"
        return f"Error communicating with {label}: No choices returned."

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()

    label = "DeepSeek" if resolved_provider == "deepseek" else "OpenAI"
    return f"Error communicating with {label}: Empty response content."

def _fallback_analysis(
    test: models.Test,
    detection: models.Detection,
    events_sample: List[Dict],
) -> Dict:
    has_logs = bool(events_sample)
    if not has_logs:
        category = "ENVIRONMENT"
        explanation = (
            "No qualifying telemetry was found for this test run, so the result is inconclusive. "
            "This usually indicates a logging or collection gap rather than a rule logic issue."
        )
        next_steps = [
            "Verify the endpoint agent/log forwarder is running on the target host.",
            "Confirm the correct index/sourcetype receives process/authentication events.",
            f"Re-run the test after confirming logs include marker {test.marker}.",
        ]
    elif (test.result or "").upper() in {"FAIL", "FAIL_RULE_VISIBILITY"}:
        category = "RULE_LOGIC"
        explanation = (
            "Telemetry is present but the detection did not fire. This points to a rule or field-mapping gap."
        )
        next_steps = [
            "Compare the detection query fields to the sample events and adjust field names.",
            "Validate any filters/thresholds that could suppress this behavior.",
            "Re-run the test after tuning the rule to confirm coverage.",
        ]
    else:
        category = "OTHER"
        explanation = (
            "The test outcome does not map cleanly to a single root cause. Review the sample events and query."
        )
        next_steps = [
            "Check that required telemetry sources are enabled for this technique.",
            "Validate parsing/normalization for key fields used in the rule.",
            "Re-run the test to confirm the result is repeatable.",
        ]

    explanation_block = (
        f"Explanation:\n- {explanation}\n- Next steps: " + "; ".join(next_steps)
    )
    return {
        "ai_explanation": explanation_block,
        "ai_suggested_rule": "No changes suggested.",
        "ai_root_cause_category": category,
        "ai_confidence_score": 40,
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
        return _fallback_analysis(test, detection, events_sample)

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
