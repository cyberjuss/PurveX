"""Structured JSON logging for PurveX.

In production (PURVEX_ENV=prod or PURVEX_ENV=staging), logs emit as single-line
JSON to stdout — friendly for log aggregators (Loki, Datadog, CloudWatch).
In dev, logs stay human-readable.

Every record includes the current request's correlation ID when one is bound
via `correlation_id_ctx.set(...)` (see RequestContextMiddleware).
"""
import contextvars
import logging
import os
import sys
from typing import Any

correlation_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "correlation_id", default=None
)


class CorrelationIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = correlation_id_ctx.get() or "-"
        return True


def _build_json_formatter():
    try:
        from pythonjsonlogger import jsonlogger
    except ImportError:
        # python-json-logger not installed — fall back to plain format
        return logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] [cid=%(correlation_id)s] %(message)s"
        )

    import datetime as _dt

    class PurveXJsonFormatter(jsonlogger.JsonFormatter):
        def add_fields(self, log_record: dict[str, Any], record: logging.LogRecord, message_dict: dict[str, Any]) -> None:
            super().add_fields(log_record, record, message_dict)
            log_record["timestamp"] = _dt.datetime.utcfromtimestamp(record.created).isoformat() + "Z"
            log_record["level"] = record.levelname
            log_record["logger"] = record.name
            log_record["correlation_id"] = getattr(record, "correlation_id", "-")

    return PurveXJsonFormatter("%(timestamp)s %(level)s %(name)s %(message)s")


def configure_logging() -> None:
    env = os.getenv("PURVEX_ENV", "dev").lower()
    use_json = env in {"prod", "staging"} or os.getenv("PURVEX_LOG_FORMAT", "").lower() == "json"

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(CorrelationIdFilter())
    if use_json:
        handler.setFormatter(_build_json_formatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)-5s [%(name)s] [cid=%(correlation_id)s] %(message)s",
            datefmt="%H:%M:%S",
        ))

    level = os.getenv("PURVEX_LOG_LEVEL", "INFO").upper()
    root.setLevel(level)
    root.addHandler(handler)

    # Quiet a couple of noisy loggers in prod
    if use_json:
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
