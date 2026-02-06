import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";

// Security middleware: applies hardened headers to all routes.

// Very lightweight in-memory rate limiter (best-effort; per-instance only).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;
// Store: ip -> { count, expires }
const rateLimitStore: Map<string, { count: number; expires: number }> = new Map();

export default function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";

  // Basic rate limiting for API routes.
  if (request.nextUrl.pathname.startsWith("/api")) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      (request as any).ip ||
      "unknown";

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
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: http:`,
        `script-src-elem 'self' 'nonce-${nonce}' https: http:`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' http://localhost:* http://127.0.0.1:*",
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
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("Origin-Agent-Cluster", "?1");

  return res;
}

export const config = {
  matcher: "/:path*",
};
