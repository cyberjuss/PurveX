"""Optional OpenTelemetry tracing setup.

No-op unless ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set. Instruments FastAPI,
SQLAlchemy, and httpx in one place so the rest of the app stays exporter-
agnostic. Service name defaults to ``purvex-api`` but can be overridden via
``OTEL_SERVICE_NAME``.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger("purvex.tracing")

_configured = False


def configure_tracing(app: Any, engine: Optional[Any] = None) -> bool:
    """Enable OTLP tracing when an endpoint is configured.

    Returns True when tracing was wired up, False when the opt-in env var was
    missing. Safe to call multiple times — instrumentation only runs once.
    """
    global _configured
    if _configured:
        return True

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError as exc:
        logger.warning("OpenTelemetry packages missing — skipping tracing setup: %s", exc)
        return False

    service_name = os.getenv("OTEL_SERVICE_NAME", "purvex-api")
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    trace.set_tracer_provider(provider)

    try:
        FastAPIInstrumentor.instrument_app(app, excluded_urls="/health,/metrics,/ready")
    except Exception:
        logger.exception("FastAPI instrumentation failed")

    if engine is not None:
        try:
            SQLAlchemyInstrumentor().instrument(
                engine=engine.sync_engine if hasattr(engine, "sync_engine") else engine
            )
        except Exception:
            logger.exception("SQLAlchemy instrumentation failed")

    try:
        HTTPXClientInstrumentor().instrument()
    except Exception:
        logger.exception("httpx instrumentation failed")

    _configured = True
    logger.info("OpenTelemetry tracing enabled (endpoint=%s, service=%s)", endpoint, service_name)
    return True
