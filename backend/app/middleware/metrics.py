"""Prometheus request metrics middleware.

Tracks per-route request counts, latency histograms, and in-flight gauge.
Exposes `/metrics` via the Prometheus text exposition format.
"""

from __future__ import annotations

import time
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match

try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        Counter,
        Gauge,
        Histogram,
        generate_latest,
    )
except ImportError:  # pragma: no cover - exercised when optional dependency missing
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4"
    Counter = Gauge = Histogram = None
    generate_latest = None

if Counter and Gauge and Histogram:
    HTTP_REQUESTS_TOTAL = Counter(
        "purvex_http_requests_total",
        "Total HTTP requests processed, labeled by method, route template, and status code.",
        ["method", "route", "status"],
    )

    HTTP_REQUEST_DURATION_SECONDS = Histogram(
        "purvex_http_request_duration_seconds",
        "HTTP request latency in seconds, labeled by method and route template.",
        ["method", "route"],
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
    )

    HTTP_REQUESTS_IN_FLIGHT = Gauge(
        "purvex_http_requests_in_flight",
        "Number of in-flight HTTP requests.",
        ["method"],
    )
else:
    HTTP_REQUESTS_TOTAL = None
    HTTP_REQUEST_DURATION_SECONDS = None
    HTTP_REQUESTS_IN_FLIGHT = None


def _route_template(request: Request) -> str:
    """Return the matched route template (e.g. "/detections/{id}") or a generic label.

    Using route templates instead of raw paths keeps cardinality bounded — otherwise
    every unique ID shows up as its own label set.
    """
    try:
        for route in request.app.routes:
            match, _ = route.matches(request.scope)
            if match == Match.FULL:
                path = getattr(route, "path", None)
                if path:
                    return path
    except Exception:
        pass
    return "__unmatched__"


class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if HTTP_REQUESTS_IN_FLIGHT is None:
            return await call_next(request)

        method = request.method
        HTTP_REQUESTS_IN_FLIGHT.labels(method=method).inc()
        start = time.perf_counter()
        status_code = 500
        response: Optional[Response] = None
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception:
            raise
        finally:
            duration = time.perf_counter() - start
            route = _route_template(request)
            # Don't record metrics for the metrics endpoint itself.
            if route != "/metrics":
                HTTP_REQUESTS_TOTAL.labels(
                    method=method, route=route, status=str(status_code)
                ).inc()
                HTTP_REQUEST_DURATION_SECONDS.labels(method=method, route=route).observe(duration)
            HTTP_REQUESTS_IN_FLIGHT.labels(method=method).dec()


def metrics_response() -> Response:
    """Render the current registry in Prometheus text format."""
    if generate_latest is None:
        return Response(
            content="# prometheus_client is not installed; metrics disabled\n",
            media_type=CONTENT_TYPE_LATEST,
        )
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
