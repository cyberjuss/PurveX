"""Request-scoped context: correlation IDs that flow through logs and responses.

Clients can pass X-Request-ID to propagate an upstream trace identifier;
otherwise we mint a UUID. The value is bound to a contextvar so every log
statement emitted during the request carries the same ID, and echoed back via
the X-Request-ID response header so clients can correlate failures.
"""
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from ..logging_config import correlation_id_ctx

REQUEST_ID_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(REQUEST_ID_HEADER)
        correlation_id = incoming if incoming and len(incoming) <= 128 else str(uuid.uuid4())
        token = correlation_id_ctx.set(correlation_id)
        request.state.correlation_id = correlation_id
        try:
            response = await call_next(request)
            response.headers[REQUEST_ID_HEADER] = correlation_id
            return response
        finally:
            correlation_id_ctx.reset(token)
