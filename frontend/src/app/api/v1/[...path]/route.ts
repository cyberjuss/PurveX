import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const COLLECTION_ROOTS_REQUIRING_TRAILING_SLASH = new Set(["detections", "tests"]);

function buildUpstreamUrl(path: string[], search: string) {
  const normalizedPath = path.join("/");
  const needsTrailingSlash =
    path.length === 1 && COLLECTION_ROOTS_REQUIRING_TRAILING_SLASH.has(path[0]);
  const suffix = needsTrailingSlash ? "/" : "";
  return `${BACKEND_URL}/${normalizedPath}${suffix}${search}`;
}

function copyRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  headers.delete("expect");
  headers.delete("transfer-encoding");
  return headers;
}

async function fetchWithBackendRedirects(
  url: string,
  init: RequestInit & { duplex?: "half" },
  remainingRedirects = 3,
): Promise<Response> {
  const response = await fetch(url, init);

  if (
    remainingRedirects > 0 &&
    [301, 302, 303, 307, 308].includes(response.status)
  ) {
    const location = response.headers.get("location");
    if (location) {
      const redirectUrl = new URL(location, url).toString();
      if (redirectUrl.startsWith(BACKEND_URL)) {
        return fetchWithBackendRedirects(redirectUrl, init, remainingRedirects - 1);
      }
    }
  }

  return response;
}

async function proxyToBackend(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const upstreamUrl = buildUpstreamUrl(path, request.nextUrl.search);
  const method = request.method.toUpperCase();
  const headers = copyRequestHeaders(request);

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer();
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetchWithBackendRedirects(upstreamUrl, init);
  } catch {
    return NextResponse.json(
      {
        detail: "Backend API is not ready yet. Please retry in a moment.",
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers(upstream.headers);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(request, context);
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(request, context);
}
