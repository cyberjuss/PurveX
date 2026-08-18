import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";

// Edge proxy (Next.js 16 successor to `middleware.ts`). Runs on every
// request matched by `config.matcher` below and handles three concerns in
// order:
//
//   1. Auth gate — redirects unauthenticated users hitting app routes to
//      `/login` before any SSR work starts.
//   2. Rate limiting — per-IP best-effort limiter for `/api` traffic so one
//      instance can't trivially be swamped.
//   3. Security headers — CSP (with per-request nonce), HSTS, COOP/CORP,
//      etc., applied to every response leaving the edge.
//
// NOTE: Next.js 16 enforces a single edge file per app. If you re-introduce
// a `middleware.ts` the build will fail with
// "Both middleware file ... and proxy file ... are detected".

const AUTH_COOKIE = "access_token";

// Routes rendered as unauthenticated (allowlist). Anything under
// `AUTH_PREFIXES` that isn't in this list requires a session cookie.
const PUBLIC_PREFIXES = [
  "/login",
  "/setup",
  "/accept-invite",
  "/legal",
];

// App surfaces that require a logged-in session. Keep in sync with the
// authenticated navigation surface (sidebar, quick links, etc.). Marketing
// pages and Next.js internals (`/_next`, `/api` proxy, favicon) are omitted
// intentionally.
const AUTH_PREFIXES = [
  "/dashboard",
  "/detections",
  "/tests",
  "/mitre",
  "/lab",
  "/reports",
  "/run-test",
  "/settings",
  "/notifications",
  "/agent",
  "/proposals",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function requiresAuth(pathname: string): boolean {
  return AUTH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Very lightweight in-memory rate limiter (best-effort; per-instance only).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;
// Store: ip -> { count, expires }
const rateLimitStore: Map<string, { count: number; expires: number }> = new Map();

export default function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const { pathname, search } = request.nextUrl;
  const hostname = request.nextUrl.hostname;
  const protocol = request.nextUrl.protocol;
  const isPotentiallyTrustworthyOrigin =
    protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";

  if (
    isDev &&
    protocol === "http:" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.hostname = "localhost";
    return NextResponse.redirect(redirectUrl, 307);
  }

  // Auth gate — cheap cookie check before SSR/data fetching. The backend
  // still authoritatively validates the token on every API call, so a
  // tampered cookie only bypasses the redirect, not the actual session.
  if (requiresAuth(pathname) && !isPublic(pathname)) {
    const hasSession = Boolean(request.cookies.get(AUTH_COOKIE)?.value);
    if (!hasSession) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("reason", "expired");
      const target = `${pathname}${search || ""}`;
      if (target && target !== "/") {
        loginUrl.searchParams.set("next", target);
      }
      return NextResponse.redirect(loginUrl);
    }
  }

  // Basic rate limiting for API routes.
  if (request.nextUrl.pathname.startsWith("/api")) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const now = Date.now();
    const entry = rateLimitStore.get(ip);
    if (!entry || entry.expires < now) {
      rateLimitStore.set(ip, { count: 1, expires: now + RATE_LIMIT_WINDOW_MS });
    } else {
      entry.count += 1;
      if (entry.count > RATE_LIMIT_MAX) {
        return new NextResponse("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      rateLimitStore.set(ip, entry);
    }
  }

  const nonce = randomBytes(16).toString("base64");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Relax CSP in dev so Next.js dev runtime (inline bootstraps, ws) can run.
  const csp = isDev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    : [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        `script-src-elem 'self' 'nonce-${nonce}'`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-CSP-Nonce", nonce);
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), interest-cohort=()");

  if (isPotentiallyTrustworthyOrigin) {
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    res.headers.set("Origin-Agent-Cluster", "?1");
  } else {
    res.headers.delete("Cross-Origin-Opener-Policy");
    res.headers.delete("Cross-Origin-Resource-Policy");
    res.headers.delete("Origin-Agent-Cluster");
  }

  if (protocol === "https:" && !isDev) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  } else {
    res.headers.delete("Strict-Transport-Security");
  }

  return res;
}

export const config = {
  matcher: "/:path*",
};
