"""Input sanitization utilities for request validation."""
from typing import Any, Dict, Union

from pydantic import BaseModel

from ..utils.security import sanitize_email, sanitize_string, sanitize_url


def _max_length_for_field(key: str) -> int:
    lowered = key.lower()
    if any(token in lowered for token in ("description", "notes", "query", "rule", "payload")):
        return 10000
    return 1000


def _sanitize_mapping(data: Dict[str, Any]) -> Dict[str, Any]:
    sanitized: Dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, str):
            lowered = key.lower()
            if "email" in lowered:
                sanitized[key] = sanitize_email(value) or value
            elif "url" in lowered or "uri" in lowered:
                sanitized[key] = sanitize_url(value) or value
            else:
                sanitized[key] = sanitize_string(value, max_length=_max_length_for_field(key))
        elif isinstance(value, dict):
            sanitized[key] = _sanitize_mapping(value)
        elif isinstance(value, list):
            sanitized[key] = [
                _sanitize_mapping(item) if isinstance(item, dict)
                else sanitize_string(item, max_length=1000) if isinstance(item, str)
                else item
                for item in value
            ]
        else:
            sanitized[key] = value
    return sanitized


def sanitize_model_inputs(model: Union[BaseModel, Dict[str, Any]]) -> Dict[str, Any]:
    """Sanitize all string fields in a Pydantic model or raw dictionary."""
    if isinstance(model, BaseModel):
        return _sanitize_mapping(model.model_dump())
    if isinstance(model, dict):
        return _sanitize_mapping(model)
    raise TypeError("sanitize_model_inputs expects a BaseModel or dict")
