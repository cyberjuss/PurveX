/**
 * Server-side API helpers for RSC data fetching.
 *
 * These run only in React Server Components / route handlers and forward
 * the incoming browser's auth cookies to the backend so SSR sees the same
 * session the user is logged in as.
 *
 * Design notes:
 *
 *   - The browser's `apiFetch` in `api.ts` talks through the `/api/v1`
 *     same-origin proxy because httpOnly cookies can't travel cross-origin.
 *     In an RSC we don't have a proxy — we are the server — so we hit the
 *     backend directly using the same URL candidates that `getApiBaseCandidates`
 *     returns when `window` is undefined.
 *
 *   - Any failure (auth, network, non-2xx) resolves to `null`. The RSC
 *     shells pass the result straight to SWR's `fallbackData`, so a `null`
 *     simply means "don't hydrate SSR data, let SWR fetch on mount". This
 *     keeps broken servers / expired sessions from breaking the render
 *     entirely.
 *
 *   - Using `next/headers` forces this module into the server bundle. If a
 *     client component imports it, the Next.js build will fail loudly —
 *     which is the guardrail we want.
 *
 *   - `cache: "no-store"` matches the browser behaviour (data is always
 *     live; list pages should reflect mutations without a hard reload).
 */
import { cookies } from "next/headers";

import {
  getApiBaseCandidates,
  type Detection,
  type TestWithDetectionTitle,
} from "./api";

/** Forwards the user's auth cookies to the backend and parses JSON. */
async function serverApiFetch<T>(path: string): Promise<T | null> {
  let cookieHeader: string;
  try {
    const store = await cookies();
    cookieHeader = store
      .getAll()
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");
  } catch {
    // cookies() throws in contexts where dynamic cookie access isn't allowed
    // (e.g. generateStaticParams). Fall back to an unauthenticated request,
    // which will 401 and cleanly become `null` below.
    cookieHeader = "";
  }

  if (!cookieHeader) {
    return null;
  }

  const bases = getApiBaseCandidates();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    for (const base of bases) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          // 401/403/etc. should fall through to client-side SWR. Don't try
          // the next backend candidate — they all share cookies, so the
          // answer will be the same.
          return null;
        }

        return (await res.json()) as T;
      } catch {
        // Try the next base only for network-level failures.
        continue;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
}

/** SSR initial data for the `/tests` list view. */
export function serverGetTests(): Promise<TestWithDetectionTitle[] | null> {
  return serverApiFetch<TestWithDetectionTitle[]>("/tests/");
}

/** SSR initial data for the `/detections` library view. */
export function serverGetDetections(): Promise<Detection[] | null> {
  return serverApiFetch<Detection[]>("/detections/");
}
