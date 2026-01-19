from __future__ import annotations

import os
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..routers.auth import get_current_user


router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantRequest(BaseModel):
  """Request body for the Watchtower /assistant/chat endpoint."""

  # Full prompt we want to send to the LLM. In a future iteration we can
  # extend this with structured fields like `alert`, `detection`, `test`, etc.
  prompt: str = Field(..., description="User message to send to the LLM.")


class AssistantResponse(BaseModel):
  """Simple wrapper for the LLM's answer text."""

  answer: str


MAX_PROMPT_CHARS = 10000  # Basic guard against extremely large prompts.


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
# Default to llama3.1 (Ollama accepts both "llama3.1" and "llama3.1:latest")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1")

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


@router.post("/chat", response_model=AssistantResponse)
async def chat_with_assistant(
  payload: AssistantRequest,
  user = Depends(get_current_user),
) -> AssistantResponse:
  """Proxy a chat prompt to the configured LLM (e.g. Ollama) and return its answer.

  This is the v1 MVP for the Watchtower AI assistant. It sends the user's prompt
  to the local/hosted LLM and returns the generated text as `answer`.
  """
  # SECURITY: Sanitize prompt input
  from ..utils.security import sanitize_string
  sanitized_prompt = sanitize_string(payload.prompt or "", max_length=MAX_PROMPT_CHARS)
  if not sanitized_prompt:
    raise HTTPException(status_code=400, detail="Prompt cannot be empty")
  
  # Basic safety check – ensure the backend has an LLM endpoint configured.
  if not OLLAMA_BASE_URL:
    raise HTTPException(status_code=503, detail="LLM backend is not configured.")

  # Simple size limit to prevent extremely large prompts from overloading the LLM.
  if len(sanitized_prompt) > MAX_PROMPT_CHARS:
    raise HTTPException(
      status_code=400,
      detail=f"Prompt is too long ({len(payload.prompt)} characters). Please shorten the question or narrow the context.",
    )

  try:
    # Try /api/chat first (newer Ollama API), fallback to /api/generate (older API)
    chat_url = f"{OLLAMA_BASE_URL}/api/chat"
    generate_url = f"{OLLAMA_BASE_URL}/api/generate"
    
    # Allow more time for local models to load/generate on first use.
    # This is especially important for larger models like llama3.1.
    async with httpx.AsyncClient(timeout=120.0) as client:
      # Try the newer chat API first
      try:
        request_payload = {
          "model": OLLAMA_MODEL,
          "messages": [
            {"role": "system", "content": WATCHTOWER_SYSTEM_PROMPT},
            {"role": "user", "content": sanitized_prompt},
          ],
          "stream": False,
        }
        print(f"[Watchtower] Calling Ollama chat API: {chat_url} with model: {OLLAMA_MODEL}")
        resp = await client.post(chat_url, json=request_payload)
        resp.raise_for_status()
        data = resp.json()
        print(f"[Watchtower] Ollama response keys: {list(data.keys())}")
        # Chat API returns `{"message": {"content": "..."}, ...}`
        answer = (data.get("message", {}).get("content") or "").strip()
        print(f"[Watchtower] Extracted answer length: {len(answer)}")
      except (httpx.HTTPError, KeyError) as chat_err:
        # Fallback to older generate API
        try:
          resp = await client.post(
            generate_url,
            json={
              "model": OLLAMA_MODEL,
              "prompt": f"{WATCHTOWER_SYSTEM_PROMPT}\n\nUser: {sanitized_prompt}\nAssistant:",
              "stream": False,
            },
          )
          resp.raise_for_status()
          data = resp.json()
          # Generate API returns `{"response": "...", "done": true, ...}`
          answer = (data.get("response") or "").strip()
        except Exception as gen_err:
          # If both APIs fail, raise with details
          raise HTTPException(
            status_code=502,
            detail=f"Both Ollama chat and generate APIs failed. Chat error: {chat_err}. Generate error: {gen_err}. Check that Ollama is running and the model '{OLLAMA_MODEL}' is available."
          ) from gen_err
      
      if not answer:
        answer = "The language model did not return any content. Please check that Ollama is running and the model is available."
      return AssistantResponse(answer=answer)
  except httpx.TimeoutException as exc:
    raise HTTPException(
      status_code=504,
      detail=(
        "Ollama request timed out after 120 seconds. The local model may be taking "
        "too long to generate a response. Try a shorter prompt or consider using a "
        "smaller model (for example 'gemma3:4b') in the OLLAMA_MODEL setting."
      ),
    ) from exc
  except httpx.ConnectError as exc:
    raise HTTPException(
      status_code=503,
      detail=f"Cannot connect to Ollama at {OLLAMA_BASE_URL}. Is Ollama running? Error: {exc}"
    ) from exc
  except httpx.HTTPError as exc:
    raise HTTPException(status_code=502, detail=f"Error calling LLM backend: {exc}") from exc
  except HTTPException:
    # Re-raise HTTPExceptions as-is
    raise
  except Exception as exc:
    import traceback
    raise HTTPException(
      status_code=500,
      detail=f"Unexpected error in Watchtower assistant: {str(exc)}. Check backend logs for details."
    ) from exc


