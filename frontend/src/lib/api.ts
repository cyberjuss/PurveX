// In the browser, all API calls go through the Next.js same-origin proxy at /api/v1
// so cookies stay same-origin. On the server (SSR/route handlers) we can hit the
// backend directly.
const PROXY_PREFIX = "/api/v1";
// Local development fallback only. Beta/prod deployments must set
// NEXT_PUBLIC_API_URL or route /api/v1 through the deployment proxy.
const DEFAULT_API_URL = "http://localhost:8001";
const LEGACY_DEFAULT_API_URLS = ["http://127.0.0.1:8001", "http://127.0.0.1:8000"];

export interface Detection {
  id: string;
  technique_id: string;
  title: string;
  description?: string | null;
  sigma_rule?: string | null;
  siem_type: string;
  siem_query: string;
  owner?: string | null;
  notes?: string | null;
  status?: string | null;
  criticality?: string | null;
  created_at?: string;
  last_updated_at?: string;
  last_tested_at?: string | null;
  last_pass_at?: string | null;
  last_fail_at?: string | null;
  last_alert_at?: string | null;
  last_reviewed_at?: string | null;
  last_result?: string | null;
  last_score?: number | null;
  lifecycle_stage?: string | null;
  source?: string | null;
  detection_source_id?: number | null;
  source_path?: string | null;
  source_commit_sha?: string | null;
}

export interface DetectionAlert {
  id: number;
  name: string;
  time: string;
  severity: string;
  host?: string | null;
  query: string;
  raw_event?: string;
  test_id?: number | null;
  created_at?: string | null;
  status?: string | null;
  source?: string | null;
  message?: string | null;
}

export interface Test {
  id: number;
  detection_id?: string | null;
  technique_id?: string | null;
  marker?: string | null;
  environment?: string;
  // Run intent persisted by the backend.
  // DETECTION_VALIDATION | ALERT_CHECK | TELEMETRY_CHECK
  mode?: TestRunMode | string | null;
  started_at: string;
  finished_at?: string | null;
  result?: string | null;
  status?: string;
  score?: number | null;
  endpoint?: string | null;
  atomic_test_id?: string | null;
  atomic_test_name?: string | null;
  atomic_test_number?: number | null;
  initiated_by_username?: string | null;
  initiated_by_role?: string | null;
}

export type TestWithDetectionTitle = Test & {
  detection_title?: string | null;
  atomic_command?: string | null;
};

export interface TestArtifact {
  id: number;
  test_id: number;
  atomic_command?: string | null;
  siem_sample_events?: string | null;
  ai_explanation?: string | null;
  ai_suggested_rule?: string | null;
  ai_root_cause_category?: string | null;
  ai_confidence_score?: number | null;
}

export type TestDetailResponse = Test & {
  detection?: Detection | null;
  artifact?: TestArtifact | null;
  detection_title?: string | null;
  telemetry_summary?: {
    has_logs?: boolean | null;
    events_found?: number | null;
  } | null;
  detection_summary?: {
    rule_fired?: boolean | null;
    alerts_found?: number | null;
  } | null;
};

export interface TestSchedule {
  id: number;
  detection_id?: string | null;
  technique_id?: string | null;
  environment?: string;
  mode?: string;
  schedule_type?: string;
  run_at?: string | null;
  cron_expression?: string | null;
  interval_minutes?: number | null;
  interval_seconds?: number | null;
  enabled?: boolean | null;
  created_at?: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
}

export type TestScheduleType = "once" | "interval" | "cron";

export interface MitreTechnique {
  id: string;
  name: string;
  tactics: string[];
  is_subtechnique?: boolean;
  platforms?: string[];
  data_sources?: string[];
}

export interface CoverageTotals {
  total_techniques: number;
  validated: number;
  at_risk: number;
  mapped: number;
  unmapped: number;
}

export interface CoverageTechniqueGap {
  technique_id: string;
  technique_name: string;
  tactics: string[];
  detection_count: number;
  max_criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  last_score?: number | null;
  last_result?: string | null;
}

export interface CoverageSummary {
  totals: CoverageTotals;
  simple_coverage_percent: number;
  weighted_coverage_percent: number;
  top_untested_high_value: CoverageTechniqueGap[];
  top_failing_high_value: CoverageTechniqueGap[];
  captured_at: string;
}

export interface CoverageTrendPoint {
  day: string; // YYYY-MM-DD
  validated: number;
  tested: number;
}

export interface CoverageTrend {
  days: number;
  points: CoverageTrendPoint[];
}

export type BootstrapStatus = {
  needs_admin: boolean;
};

export type BootstrapAdminRequest = {
  username: string;
  password: string;
  email?: string;
};

// These mirror backend Pydantic models with many optional/evolving fields
// that callers across the app read ad hoc (JSX property access, spreads).
// `unknown` would push a `Record<string, unknown>` cast onto every one of
// those call sites for no real safety gain -- the shape genuinely isn't
// modeled today.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type AtomicTestDefinition = Record<string, any>;
export type OrganizationSettings = Record<string, any>;
export type SIEMConnection = Record<string, any>;
export type EnvironmentRunnerConfig = Record<string, any>;
export type TestingPolicySettings = Record<string, any>;
export type DetectionScoringSettings = Record<string, any>;
export type AIAssistantSettings = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Build a list of API base URLs to try.
 * - In the browser, stay on the same origin and let Next proxy requests.
 * - On the server, allow an explicit backend URL override and otherwise fall
 *   back to local backend addresses for single-machine development.
 */
export function getApiBaseCandidates(): string[] {
  // Browser clients must stay same-origin to avoid split cookie/session state.
  if (typeof window !== "undefined") {
    return [PROXY_PREFIX];
  }

  // Server-side (SSR): hit the backend directly.
  const candidates = new Set<string>();
  if (process.env.NEXT_PUBLIC_API_URL) {
    candidates.add(process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, ""));
  }
  candidates.add(DEFAULT_API_URL);
  for (const legacy of LEGACY_DEFAULT_API_URLS) {
    candidates.add(legacy);
  }
  return Array.from(candidates);
}

/**
 * Minimal client-side error logger for the MVP.
 * Currently writes to the console only -- swap to a real telemetry sink later.
 */
function logClientError(context: string, error: unknown) {
  console.error(`[PurveX] ${context}`, error);
}

// apiFetch tags thrown errors with `is404`/`silent` (see below) so callers
// treating a 404 as an expected, non-error outcome don't have to re-parse
// the message string.
interface ApiError extends Error {
  is404?: boolean;
  silent?: boolean;
}

function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const apiErr = err as ApiError;
  const message = apiErr.message?.toLowerCase() ?? "";
  return apiErr.is404 === true || message.includes("not found") || message.includes("404");
}

function normalizeHeaders(input?: HeadersInit): Record<string, string> {
  if (!input) return {};

  if (input instanceof Headers) {
    const result: Record<string, string> = {};
    input.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  if (Array.isArray(input)) {
    return input.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }

  return { ...input };
}

/**
 * Clear local session state and optionally bounce the user back to /login.
 * This is used on hard auth failures (401/403) and when the session is stale.
 */
// Set while an intentional logout is in flight. Logging out blacklists the
// session token immediately, so any request racing against it (e.g. a
// background poll) sees a 401 too. Without this flag, that race would fire
// the "session expired" hard redirect and stomp on the clean post-logout
// redirect to a plain /login.
let _isLoggingOut = false;
export function setLoggingOut(value: boolean) {
  _isLoggingOut = value;
}

function clearSessionAndRedirect(reason: "expired" | "unauthorized") {
  if (typeof window === "undefined") return;
  if (_isLoggingOut) return;

  try {
    localStorage.removeItem("purvex_username");
    localStorage.removeItem("purvex_user_role");
    localStorage.removeItem("purvex_logged_in");
    localStorage.removeItem("purvex_csrf_token");
    localStorage.removeItem("purvex_csrf_token_time");
  } catch (err) {
    logClientError("Failed to clear session storage", err);
  }

  // Avoid redirect loops if we're already on the login page.
  if (window.location.pathname === "/login") return;

  const search = reason ? `?reason=${reason}` : "";
  window.location.href = `/login${search}`;
}

/**
 * Get or fetch CSRF token for the current user.
 * Tokens are cached in localStorage and refreshed as needed.
 */
// SECURITY: CSRF token stored in memory only (not localStorage) to prevent XSS theft
let _csrfToken: string | null = null;
let _csrfTokenTime: number = 0;

async function getCsrfToken(forceRefresh = false): Promise<string | null> {
  if (typeof window === "undefined") return null;

  if (!forceRefresh && _csrfToken) {
    const age = Date.now() - _csrfTokenTime;
    if (age < 3600000) {
      return _csrfToken;
    }
  }

  // Fetch new token
  try {
    const apiBases = getApiBaseCandidates();
    for (const base of apiBases) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        const res = await fetch(`${base}/auth/csrf-token`, {
          method: "GET",
          headers,
          credentials: "include",
        });

        if (res.ok) {
          const data = await res.json();
          const csrfToken = data.csrf_token;
          if (csrfToken) {
            _csrfToken = csrfToken;
            _csrfTokenTime = Date.now();
            return csrfToken;
          }
        }
      } catch {
        // Try next base URL
        continue;
      }
    }
  } catch (err) {
    logClientError("Failed to fetch CSRF token", err);
  }

  return null;
}

/**
 * Shared API helper that attaches auth (httpOnly cookies)
 * and normalises error handling for all frontend HTTP calls.
 *
 * - Assumes the backend reads the primary auth token from httpOnly cookies.
 * - Automatically includes CSRF token for state-changing requests.
 */
export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...normalizeHeaders(options.headers),
  };
  const isSilent = headers["X-Purvex-Silent"] === "true";
  if (headers["X-Purvex-Silent"]) {
    delete headers["X-Purvex-Silent"];
  }

  const method = (options.method || "GET").toUpperCase();
  const requiresCsrf = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  if (typeof window !== "undefined") {
    // SECURITY: Add CSRF token for state-changing requests
    if (requiresCsrf) {
      const csrfToken = await getCsrfToken();
      if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken;
      }
    }
  }

  const apiBases = getApiBaseCandidates();
  let lastNetworkError: unknown = null;
  const timeoutMs = path.startsWith("/atomic/") ? 90000 : 12000;

  const attemptedBases: string[] = [];

  for (const base of apiBases) {
    attemptedBases.push(base);
    let retriedCsrf = false;

    while (true) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        if (options.signal) {
          if (options.signal.aborted) {
            controller.abort();
          } else {
            options.signal.addEventListener("abort", () => controller.abort(), { once: true });
          }
        }
        const res = await fetch(`${base}${path}`, {
          ...options,
          // Always send cookies for httpOnly token flows.
          credentials: "include",
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const text = await res.text();
          let errorDetail = "The request failed. Please try again or contact support.";
          let parsedError: { detail?: string; message?: string } | null = null;

          // Try to parse error detail from response
          try {
            parsedError = JSON.parse(text);
            if (parsedError?.detail) {
              errorDetail = parsedError.detail;
            } else if (parsedError?.message) {
              errorDetail = parsedError.message;
            }
          } catch {
            // If parsing fails, use the text as-is if it's not too long
            if (text && text.length < 200) {
              errorDetail = text;
            }
          }

          if (res.status === 401) {
            // /auth/me is a probe — callers expect a plain throw so they can
            // decide what to do (show login, etc.) without triggering a redirect.
            if (path === "/auth/me") {
              throw new Error(errorDetail);
            }

            if (!isSilent) {
              logClientError(`API auth error ${res.status} on ${path}`, text);
            }

            // For any other protected endpoint, a 401 means the user has no
            // valid session cookie (missing, expired, revoked, or browser
            // stripped it). Re-verify against /auth/me to distinguish between
            // "endpoint-specific auth edge case" and "session is gone".
            let sessionValid = false;
            try {
              const sessionRes = await fetch(`${base}/auth/me`, {
                credentials: "include",
                cache: "no-store",
              });
              sessionValid = sessionRes.ok;
            } catch {
              sessionValid = false;
            }

            if (!sessionValid) {
              // Always bounce to /login — do NOT gate on a localStorage
              // session hint, because a missing hint is exactly the state a
              // freshly-loaded tab or cleared browser is in, and the user
              // should still be sent to the login page instead of seeing a
              // stuck "Not authenticated" error on the protected page.
              clearSessionAndRedirect("expired");
              throw new Error("Your session has expired. Please sign in again.");
            }

            // /auth/me is OK but this endpoint returned 401 — surface the
            // original error detail from the server.
            throw new Error(errorDetail);
          }

          // 402 is our own convention: the request was well-formed and the
          // user is allowed to make it, but the org's plan doesn't cover it
          // (seat/runner/daily-run limit, or a paid-only feature). Distinct
          // from 403 (permission/CSRF) so callers can show an upgrade
          // prompt instead of a generic error. Never retried.
          if (res.status === 402) {
            if (!isSilent) {
              logClientError(`API upgrade-required 402 on ${path}`, text);
            }
            const upgradeError = new Error(errorDetail) as Error & { isUpgradeRequired?: boolean };
            upgradeError.isUpgradeRequired = true;
            throw upgradeError;
          }

          // Handle rate limiting (429) with user-friendly message
          if (res.status === 429) {
            if (!isSilent) {
              logClientError(`API rate limit error ${res.status} on ${path}`, text);
            }
            // Extract retry-after header if available
            const retryAfter = res.headers.get("Retry-After");
            const retryMessage = retryAfter
              ? `Please wait ${retryAfter} seconds before trying again.`
              : "Too many requests. Please slow down and try again in a moment.";
            throw new Error(retryMessage);
          }

          // Retry once with a fresh CSRF token on 403
          if (res.status === 403 && requiresCsrf && !retriedCsrf) {
            retriedCsrf = true;
            const csrfToken = await getCsrfToken(true);
            if (csrfToken) {
              headers["X-CSRF-Token"] = csrfToken;
            }
            continue;
          }

          // Don't log 404 errors - they're often expected (e.g., optional resources that may not exist)
          // For test endpoints, we'll handle 404s gracefully by returning null in getTest
          // Still throw the error so components can handle it appropriately, but don't log it
          if (res.status !== 404) {
            if (!isSilent) {
              logClientError(`API error ${res.status} on ${path}`, text);
            }
          }
          // Create error without logging - let the caller handle it
          // For test endpoints, use a silent error that won't be logged by Next.js
          const error = res.status === 404 && path.startsWith('/tests/')
            ? new Error() // Silent error for test 404s - no message to prevent logging
            : new Error(errorDetail);
          // Mark 404 errors so getTest can identify them
          if (res.status === 404) {
            (error as ApiError).is404 = true;
            // For test endpoints, mark as silent to prevent console logging
            if (path.startsWith('/tests/')) {
              (error as ApiError).silent = true;
            }
          }
          throw error;
        }

        if (res.status === 204) {
          return null;
        }

        const contentLength = res.headers.get("content-length");
        if (contentLength === "0") {
          return null;
        }

        return res.json();
      } catch (err) {
        const isFetchFailure =
          err instanceof TypeError ||
          (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError");

        if (!isFetchFailure) {
          throw err;
        }

        lastNetworkError = err;
        break;
      }
    }
  }

  const expectedUnauthenticatedFinal = path === "/auth/me";

  if (lastNetworkError && !isSilent && !expectedUnauthenticatedFinal) {
    logClientError(`All API base URL attempts failed for ${path}`, {
      attemptedBases,
      error: lastNetworkError,
    });
  }

  throw lastNetworkError || new Error("Unable to reach the backend API.");
}
export async function getDetections(): Promise<Detection[]> {
  return apiFetch("/detections/", { cache: "no-store" });
}

export async function getDetection(id: string): Promise<Detection | null> {
  try {
    return await apiFetch(`/detections/${id}`, { cache: "no-store" });
  } catch (err) {
    // For optional resources, silently return null for 404s
    if (isNotFoundError(err)) {
      // Return null instead of throwing - this is expected behavior
      return null;
    }
    // Re-throw other errors (network errors, auth errors, etc.)
    throw err;
  }
}

export type DetectionVersionKPI = {
  version_label: string;
  version_hash: string | null;
  runs: number;
  pass_rate: number;
  fail_rate: number;
  inconclusive_rate: number;
  first_seen: string | null;
  last_seen: string | null;
  is_current: boolean;
  // Signed pass-rate delta vs. the immediate predecessor in versions[],
  // in whole percentage points. NULL on v1 (no predecessor) and on any
  // version where either side has zero runs.
  delta_pass_pct: number | null;
  // Label of the version we compared against (e.g. "v1"). NULL when
  // delta_pass_pct is NULL.
  compared_to_label: string | null;
};

export type DetectionVersionKPIResponse = {
  detection_id: string;
  current_version_hash: string;
  // Linear sequence v1 → v2 → … → current. Pre-versioning runs are NOT
  // here — they live on `legacy` so the main list stays comparable.
  versions: DetectionVersionKPI[];
  legacy: DetectionVersionKPI | null;
};

export async function getDetectionVersionKPIs(
  detectionId: string,
): Promise<DetectionVersionKPIResponse | null> {
  try {
    return await apiFetch(`/detections/${detectionId}/version-kpis`, {
      cache: "no-store",
    });
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export async function getDetectionAlerts(detectionId: string): Promise<DetectionAlert[]> {
  try {
    return await apiFetch(`/detections/${detectionId}/alerts`, { cache: "no-store" });
  } catch (err) {
    // For optional resources, silently return empty array for 404s
    if (isNotFoundError(err)) {
      // Return empty array instead of throwing - this is expected behavior
      return [] as DetectionAlert[];
    }
    // Re-throw other errors (network errors, auth errors, etc.)
    throw err;
  }
}

export interface AssistantStreamRequest {
  prompt?: string;
  action?: string;
  context_scope?: "portfolio" | "detection";
  detection_id?: string | null;
  alert_id?: number | null;
  model_name?: string;
  analyst_goal?: string;
}

export interface AssistantStreamHandlers {
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * Stream the Watchtower assistant response token-by-token via SSE.
 *
 * The backend emits `data: {"type":"delta","content":"..."}` for each chunk,
 * a final `{"type":"done"}`, and on upstream failure a `{"type":"error",...}`
 * with the real provider-unavailable message.
 */
export async function streamAssistantChat(
  body: AssistantStreamRequest,
  handlers: AssistantStreamHandlers,
): Promise<void> {
  const { onDelta, onDone, onError, signal } = handlers;
  const apiBases = getApiBaseCandidates();
  const base = apiBases[0] ?? PROXY_PREFIX;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (typeof window !== "undefined") {
    const csrfToken = await getCsrfToken();
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${base}/assistant/chat/stream`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      onDone();
      return;
    }
    onError(err instanceof Error ? err.message : "Streaming request failed.");
    return;
  }

  if (!response.ok || !response.body) {
    let detail = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      const parsed = JSON.parse(text);
      detail = parsed?.detail || text || detail;
    } catch {
      // ignore — keep the HTTP status as the detail.
    }
    onError(detail);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by blank lines (\n\n). Drain any complete
      // messages from the buffer and keep the trailing partial.
      let separatorIdx = buffer.indexOf("\n\n");
      while (separatorIdx !== -1) {
        const rawEvent = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);

        for (const line of rawEvent.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          try {
            const event = JSON.parse(dataStr) as { type: string; content?: string };
            if (event.type === "delta" && event.content) {
              onDelta(event.content);
            } else if (event.type === "done") {
              onDone();
              return;
            } else if (event.type === "error") {
              onError(event.content ?? "AI provider returned an error.");
              return;
            }
          } catch {
            // Drop malformed events rather than killing the stream.
          }
        }

        separatorIdx = buffer.indexOf("\n\n");
      }
    }
    onDone();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      onDone();
      return;
    }
    onError(err instanceof Error ? err.message : "Streaming connection dropped.");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export async function createDetection(payload: Omit<Detection, "id">): Promise<Detection> {
  return apiFetch("/detections/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type DetectionLifecycleStage =
  | "identify"
  | "design"
  | "develop"
  | "test"
  | "deploy"
  | "maintain";

export const DETECTION_LIFECYCLE_STAGES: DetectionLifecycleStage[] = [
  "identify",
  "design",
  "develop",
  "test",
  "deploy",
  "maintain",
];

export interface DetectionUpdatePayload {
  owner?: string | null;
  notes?: string | null;
  status?: string | null;
  criticality?: string | null;
  lifecycle_stage?: DetectionLifecycleStage | null;
}

export async function updateDetection(
  detectionId: string,
  patch: DetectionUpdatePayload
): Promise<Detection> {
  return apiFetch(`/detections/${detectionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export type TestRunMode = "DETECTION_VALIDATION" | "ALERT_CHECK" | "TELEMETRY_CHECK";

export async function runTest(
  params: {
    detectionId?: string | null;
    techniqueId?: string | null;
    environment: "lab" | "dev" | "prod";
    mode?: TestRunMode;
    atomic?: {
      atomic_test_id?: string;
      atomic_test_name?: string;
      atomic_test_number?: number;
      atomic_args?: Record<string, unknown>;
    };
    labOs?: "windows" | "linux" | "both";
    endpoint?: string | null;
  }
): Promise<Test> {
  const body: Record<string, unknown> = {
    environment: params.environment,
  };

  if (params.detectionId) {
    body.detection_id = params.detectionId;
  }
  if (params.techniqueId) {
    body.technique_id = params.techniqueId;
  }
  if (params.mode) {
    body.mode = params.mode;
  }
  if (params.atomic) {
    Object.assign(body, params.atomic);
  }
  if (params.labOs) {
    body.lab_os = params.labOs;
  }
  if (params.endpoint) {
    body.endpoint = params.endpoint;
  }

  return apiFetch("/tests/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getTests(): Promise<TestWithDetectionTitle[]> {
  return apiFetch("/tests/", { cache: "no-store" });
}

export async function getTest(id: number): Promise<TestDetailResponse | null> {
  // Use Promise.resolve to wrap the call and immediately catch 404s
  // This prevents Next.js from logging unhandled promise rejections in development
  return Promise.resolve(
    apiFetch(`/tests/${id}`, {
      cache: "no-store",
      headers: {
        "X-Purvex-Silent": "true",
      },
    })
  )
    .then((result) => result)
    .catch((err: unknown) => {
      // For optional resources like tests, silently return null for 404s
      // This prevents console errors for expected scenarios (tests may be deleted)
      if (isNotFoundError(err)) {
        // Return null instead of throwing - this is expected behavior
        // The promise resolves successfully with null, preventing any error logging
        // This prevents Next.js from logging the error in development mode
        return null;
      }
      // Re-throw other errors (network errors, auth errors, etc.)
      // These are real errors that should be logged
      throw err;
    });
}

export async function getTestSchedules(): Promise<TestSchedule[]> {
  return apiFetch("/tests/schedules", { cache: "no-store" });
}

export async function createTestSchedule(params: {
  detectionId?: string | null;
  techniqueId?: string | null;
  environment: "lab" | "dev" | "prod";
  mode: TestRunMode;
  scheduleType: TestScheduleType;
  runAt?: string | null;
  intervalMinutes?: number | null;
  cronExpression?: string | null;
}): Promise<TestSchedule> {
  const body: Record<string, unknown> = {
    environment: params.environment,
    mode: params.mode,
    schedule_type: params.scheduleType,
  };

  if (params.detectionId) {
    body.detection_id = params.detectionId;
  }
  if (params.techniqueId) {
    body.technique_id = params.techniqueId;
  }
  if (params.runAt) {
    body.run_at = params.runAt;
  }
  if (params.intervalMinutes && params.intervalMinutes > 0) {
    body.interval_seconds = params.intervalMinutes * 60;
  }
  if (params.cronExpression) {
    body.cron_expression = params.cronExpression;
  }

  return apiFetch("/tests/schedules", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTestSchedule(
  scheduleId: number,
  updates: { enabled?: boolean; intervalSeconds?: number | null; cronExpression?: string | null; runAt?: string | null }
): Promise<TestSchedule> {
  const body: Record<string, unknown> = {};
  if (updates.enabled !== undefined) body.enabled = updates.enabled;
  if (updates.intervalSeconds !== undefined) body.interval_seconds = updates.intervalSeconds;
  if (updates.cronExpression !== undefined) body.cron_expression = updates.cronExpression;
  if (updates.runAt !== undefined) body.run_at = updates.runAt;
  return apiFetch(`/tests/schedules/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTestSchedule(scheduleId: number): Promise<void> {
  return apiFetch(`/tests/schedules/${scheduleId}`, {
    method: "DELETE",
  });
}

export async function getMitreTechniques(): Promise<MitreTechnique[]> {
  return apiFetch("/mitre/techniques", { cache: "no-store" });
}

export async function getCoverageSummary(): Promise<CoverageSummary> {
  return apiFetch("/mitre/coverage/summary", { cache: "no-store" });
}

export async function getCoverageTrend(days = 30): Promise<CoverageTrend> {
  return apiFetch(`/mitre/coverage/trend?days=${days}`, { cache: "no-store" });
}

// ---------------------------------------------------------------------------
// Detection proposals (AI remediation guardrails)
// ---------------------------------------------------------------------------

export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "superseded";

export type ProposalAction = "create" | "update" | "delete";
export type ProposalProposerKind = "ai" | "user" | "git";

export interface DetectionProposalDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

export interface DetectionProposal {
  id: string;
  organization_id: number;
  detection_id: string | null;
  detection_title: string | null;
  proposed_by_kind: ProposalProposerKind;
  proposed_by_user_id: number | null;
  proposed_by_label: string;
  action: ProposalAction;
  status: ProposalStatus;
  reason: string | null;
  target_fields: Record<string, unknown>;
  current_snapshot: Record<string, unknown> | null;
  diff: DetectionProposalDiffEntry[];
  stale: boolean;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: number | null;
  reviewed_by_label: string | null;
  review_note: string | null;
}

export interface DetectionProposalStats {
  pending: number;
  approved: number;
  applied: number;
  rejected: number;
  superseded: number;
}

export interface DetectionProposalCreate {
  detection_id?: string | null;
  action: ProposalAction;
  proposed_by_kind?: ProposalProposerKind;
  proposed_by_label?: string;
  reason?: string | null;
  target_fields?: Record<string, unknown>;
}

export async function listProposals(params: {
  status?: ProposalStatus;
  detectionId?: string;
  skip?: number;
  limit?: number;
} = {}): Promise<DetectionProposal[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.detectionId) qs.set("detection_id", params.detectionId);
  if (params.skip != null) qs.set("skip", String(params.skip));
  if (params.limit != null) qs.set("limit", String(params.limit));
  const query = qs.toString();
  const path = query ? `/proposals?${query}` : "/proposals";
  return apiFetch(path, { cache: "no-store" });
}

export async function getProposalStats(): Promise<DetectionProposalStats> {
  return apiFetch("/proposals/stats", { cache: "no-store" });
}

export async function createProposal(
  body: DetectionProposalCreate,
): Promise<DetectionProposal> {
  return apiFetch("/proposals", {
    method: "POST",
    body: JSON.stringify({
      proposed_by_kind: "ai",
      proposed_by_label: "PurveX Assistant",
      ...body,
    }),
  });
}

export async function approveProposal(
  id: string,
  note?: string,
): Promise<DetectionProposal> {
  return apiFetch(`/proposals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note: note ?? null }),
  });
}

export interface PlatformNotification {
  id: number;
  organization_id: number;
  type: string;
  title: string;
  description: string | null;
  action_url: string | null;
  status: "success" | "warning" | "error" | "info";
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
}

export async function getNotifications(params: {
  unreadOnly?: boolean;
} = {}): Promise<PlatformNotification[]> {
  const qs = new URLSearchParams();
  if (params.unreadOnly) qs.set("status", "unread");
  const query = qs.toString();
  const path = query ? `/notifications?${query}` : "/notifications";
  return apiFetch(path, { cache: "no-store" });
}

export async function dismissNotification(id: number): Promise<PlatformNotification> {
  return apiFetch(`/notifications/${id}/dismiss`, { method: "POST" });
}

export async function rejectProposal(
  id: string,
  note?: string,
): Promise<DetectionProposal> {
  return apiFetch(`/proposals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note: note ?? null }),
  });
}

// ---------------------------------------------------------------------------
// Detection-as-Code (Sprint 3)
// ---------------------------------------------------------------------------

export type DetectionSourceAuthType = "none" | "token";
export type DetectionSourceSyncStatus = "success" | "error" | null;

export interface DetectionSource {
  id: number;
  organization_id: number;
  name: string;
  provider: string;
  repo_url: string;
  branch: string;
  path_glob: string;
  auth_type: DetectionSourceAuthType;
  enabled: boolean;
  has_auth_secret: boolean;
  last_synced_at?: string | null;
  last_sync_status?: DetectionSourceSyncStatus;
  last_sync_error?: string | null;
  last_commit_sha?: string | null;
  last_created_count: number;
  last_updated_count: number;
  last_proposals_count: number;
  last_skipped_count: number;
  created_at: string;
}

export interface DetectionSourceCreate {
  name: string;
  repo_url: string;
  branch?: string;
  path_glob?: string;
  auth_type?: DetectionSourceAuthType;
  auth_secret?: string | null;
  enabled?: boolean;
  provider?: string;
}

export interface DetectionSourceSyncResult {
  source_id: number;
  commit_sha: string | null;
  created: number;
  updated: number;
  proposals: number;
  skipped: number;
  errors: string[];
}

export interface DetectionExportPayload {
  id: string;
  yaml: string;
}

export async function listDetectionSources(): Promise<DetectionSource[]> {
  return apiFetch("/detection-sources", { cache: "no-store" });
}

export async function createDetectionSource(
  body: DetectionSourceCreate,
): Promise<DetectionSource> {
  return apiFetch("/detection-sources", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteDetectionSource(id: number): Promise<void> {
  await apiFetch(`/detection-sources/${id}`, { method: "DELETE" });
}

export async function syncDetectionSource(
  id: number,
): Promise<DetectionSourceSyncResult> {
  return apiFetch(`/detection-sources/${id}/sync`, { method: "POST" });
}

export async function exportDetectionYaml(
  detectionId: string,
): Promise<DetectionExportPayload> {
  return apiFetch(`/detections/${detectionId}/export?format=yaml`, {
    cache: "no-store",
  });
}

// ---------------------------------------------------------------------------
// SIEM → Git audit mirror (Sprint 4)
// ---------------------------------------------------------------------------

export type DetectionMirrorAuthType = "none" | "token";
export type DetectionMirrorWriteMode = "direct" | "branch" | "pr";
export type DetectionMirrorStatus = "success" | "error" | null;

export interface DetectionGitMirror {
  id: number;
  organization_id: number;
  name: string;
  repo_url: string;
  branch: string;
  path_template: string;
  commit_author_name: string;
  commit_author_email: string;
  write_mode: DetectionMirrorWriteMode;
  auth_type: DetectionMirrorAuthType;
  enabled: boolean;
  has_auth_secret: boolean;
  last_mirrored_at?: string | null;
  last_mirror_status?: DetectionMirrorStatus;
  last_mirror_error?: string | null;
  last_commit_sha?: string | null;
  last_commits_count: number;
  last_files_written: number;
  created_at: string;
}

export interface DetectionGitMirrorCreate {
  name: string;
  repo_url: string;
  branch?: string;
  path_template?: string;
  commit_author_name?: string;
  commit_author_email?: string;
  write_mode?: DetectionMirrorWriteMode;
  auth_type?: DetectionMirrorAuthType;
  auth_secret?: string | null;
  enabled?: boolean;
}

export interface DetectionMirrorPublishResult {
  mirror_id: number;
  commit_sha: string | null;
  files_written: number;
  commits: number;
  skipped: number;
  errors: string[];
}

export async function listDetectionMirrors(): Promise<DetectionGitMirror[]> {
  return apiFetch("/detection-mirrors", { cache: "no-store" });
}

export async function createDetectionMirror(
  body: DetectionGitMirrorCreate,
): Promise<DetectionGitMirror> {
  return apiFetch("/detection-mirrors", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteDetectionMirror(id: number): Promise<void> {
  await apiFetch(`/detection-mirrors/${id}`, { method: "DELETE" });
}

export async function linkMirrorToSiem(
  mirrorId: number,
  siemId: number,
): Promise<DetectionGitMirror> {
  return apiFetch(`/detection-mirrors/${mirrorId}/link-siem/${siemId}`, {
    method: "POST",
  });
}

export async function unlinkMirrorFromSiem(
  mirrorId: number,
  siemId: number,
): Promise<DetectionGitMirror> {
  return apiFetch(`/detection-mirrors/${mirrorId}/unlink-siem/${siemId}`, {
    method: "POST",
  });
}

export async function bootstrapMirror(
  mirrorId: number,
  siemId: number,
): Promise<DetectionMirrorPublishResult> {
  return apiFetch(
    `/detection-mirrors/${mirrorId}/bootstrap?siem_id=${siemId}`,
    { method: "POST" },
  );
}

export interface Report {
  id: number;
  report_id: string;
  title: string;
  generated_at: string;
  start_date: string;
  end_date: string;
  environments: string[];
  overall_health_score: number | null;
  total_detections: number;
  total_tests: number;
  file_path: string | null;
  file_size: number | null;
}

export interface ReportCreate {
  start_date: string;
  end_date: string;
  environments: string[];
  title?: string;
}

export async function generateReport(reportData: ReportCreate): Promise<Report> {
  return apiFetch("/reports/generate", {
    method: "POST",
    body: JSON.stringify(reportData),
  });
}

export async function getReports(): Promise<Report[]> {
  return apiFetch("/reports", { cache: "no-store" });
}

export async function downloadReport(reportId: string): Promise<Blob> {
  const response = await fetch(`/api/reports/${reportId}/download`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to download report");
  return response.blob();
}

export async function deleteReport(reportId: string): Promise<void> {
  return apiFetch(`/reports/${reportId}`, {
    method: "DELETE",
  });
}

// --- RBAC API ---

export async function getMyRoles(): Promise<string[]> {
  return apiFetch("/rbac/me/roles", { cache: "no-store" });
}

export async function getMyPermissions(): Promise<string[]> {
  return apiFetch("/rbac/me/permissions", { cache: "no-store" });
}

export async function getUsers(): Promise<Array<{ id: number; email: string; is_admin: boolean; is_active: boolean; created_at: string }>> {
  return apiFetch("/rbac/users", { cache: "no-store" });
}

export async function listRoles(): Promise<Array<{ id: number; name: string; description: string; is_system: boolean }>> {
  return apiFetch("/rbac/roles", { cache: "no-store" });
}

export async function getUserRoles(userId: number): Promise<Array<{ id: number; role_id: number; role_name: string; assigned_at: string; expires_at: string | null }>> {
  return apiFetch(`/rbac/users/${userId}/roles`, { cache: "no-store" });
}

export async function assignRole(userId: number, roleName: string, expiresAt?: string): Promise<{ id: number; user_id: number; role_name: string; assigned_at: string }> {
  const body: Record<string, unknown> = { role_name: roleName };
  if (expiresAt) {
    body.expires_at = expiresAt;
  }
  return apiFetch(`/rbac/users/${userId}/roles`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function removeRole(userId: number, roleId: number): Promise<void> {
  return apiFetch(`/rbac/users/${userId}/roles/${roleId}`, {
    method: "DELETE",
  });
}

export async function setUserPassword(
  userId: number,
  currentPassword: string,
  password: string
): Promise<{ message: string }> {
  return apiFetch(`/rbac/users/${userId}/password`, {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, password }),
  });
}

export async function setUserActive(userId: number, isActive: boolean): Promise<{ message: string }> {
  return apiFetch(`/rbac/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: isActive }),
  });
}

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  return apiFetch("/auth/bootstrap/status", { cache: "no-store" });
}

export async function bootstrapAdmin(payload: BootstrapAdminRequest): Promise<unknown> {
  return apiFetch("/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- Test queue maintenance ---

// --- Atomic catalog API ---

export async function getAtomicTests(params?: {
  technique_id?: string;
  q?: string;
  platform?: string;
  limit?: number;
  offset?: number;
  silent?: boolean;
}): Promise<{ items: AtomicTestDefinition[]; total: number }> {
  const { silent, ...queryParams } = params || {};
  const query = new URLSearchParams(
    Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== null) as [
      string,
      string
    ][]
  ).toString();

  return apiFetch(`/atomic/tests${query ? `?${query}` : ""}`, {
    cache: "no-store",
    headers: silent ? { "X-Purvex-Silent": "true" } : undefined,
  });
}

// Resolves a single atomic test definition by its id — used to look up a
// display name/description from just the `a` query param on /run-test
// instead of carrying atomic_name/atomic_number around in the URL.
export async function getAtomicTest(atomicId: string): Promise<AtomicTestDefinition> {
  return apiFetch(`/atomic/tests/${encodeURIComponent(atomicId)}`, {
    cache: "no-store",
  });
}

export interface AtomicCatalogStatus {
  installed: boolean;
  count: number;
  path: string;
}

export async function getAtomicCatalogStatus(): Promise<AtomicCatalogStatus> {
  return apiFetch("/atomic/catalog/status", { cache: "no-store" });
}

export async function downloadAtomicCatalog(): Promise<AtomicCatalogStatus> {
  return apiFetch("/atomic/catalog/download", {
    method: "POST",
  });
}

// --- Settings API Functions ---

export async function getOrganizationSettings(): Promise<OrganizationSettings> {
  return apiFetch("/settings/organization");
}

export interface LicenseStatus {
  plan: "free" | "paid";
  seat_limit: number | null;
  runner_limit: number | null;
  has_saved_key: boolean;
  source: "database" | "env" | "none";
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  return apiFetch("/settings/license", { cache: "no-store" });
}

export async function updateLicenseKey(licenseKey: string): Promise<LicenseStatus> {
  return apiFetch("/settings/license", {
    method: "PUT",
    body: JSON.stringify({ license_key: licenseKey }),
  });
}

export async function clearLicenseKey(): Promise<LicenseStatus> {
  return apiFetch("/settings/license", { method: "DELETE" });
}

export async function getSiemConnections(): Promise<SIEMConnection[]> {
  return apiFetch("/settings/siem-connections");
}

export async function getEnvironmentRunners(): Promise<EnvironmentRunnerConfig[]> {
  return apiFetch("/settings/environment-runners");
}

export async function getTestingPolicySettings(): Promise<TestingPolicySettings> {
  return apiFetch("/settings/testing-policy");
}

export async function getDetectionScoringSettings(): Promise<DetectionScoringSettings> {
  return apiFetch("/settings/detection-scoring");
}

// --- Audit Log API ---

export interface AuditEvent {
  id: number;
  user_id: number | null;
  user_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: string | null;
  created_at: string;
}

export interface AuditStats {
  total_events: number;
  period_days: number;
  events_by_action: Record<string, number>;
  events_by_resource: Record<string, number>;
  top_users: Record<string, number>;
}

export async function getAuditEvents(params?: {
  skip?: number;
  limit?: number;
  action?: string;
  resource_type?: string;
  user_id?: number;
  start_date?: string;
  end_date?: string;
  search?: string;
}): Promise<AuditEvent[]> {
  const query = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null) as [
      string,
      string
    ][]
  ).toString();
  
  return apiFetch(`/audit/events${query ? `?${query}` : ""}`, { cache: "no-store" });
}

export async function getAuditStats(days: number = 7): Promise<AuditStats> {
  return apiFetch(`/audit/events/stats?days=${days}`, { cache: "no-store" });
}

export async function cleanupAuditEvents(days?: number): Promise<{ deleted: number; retention_days: number; cutoff: string }> {
  const query = days ? `?days=${days}` : "";
  return apiFetch(`/audit/cleanup${query}`, {
    method: "POST",
  });
}
