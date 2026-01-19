"""
Input sanitization utilities for request validation.
"""
from typing import Any, Dict, Union
from pydantic import BaseModel
from ..utils.security import sanitize_string, sanitize_email, sanitize_url


def sanitize_model_inputs(model: Union[BaseModel, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Sanitize all string fields in a Pydantic model or raw dictionary.
    
    Args:
        model: Pydantic model instance or dictionary
    
    Returns:
        Dictionary of sanitized values
    """
    if isinstance(model, BaseModel):
        data = model.model_dump()
    elif isinstance(model, dict):
        data = model
    else:
        raise TypeError("sanitize_model_inputs expects a BaseModel or dict")

    sanitized = {}
    
    for key, value in data.items():
        if isinstance(value, str):
            # Apply appropriate sanitization based on field name
            if "email" in key.lower():
                sanitized[key] = sanitize_email(value) or value
            elif "url" in key.lower() or "uri" in key.lower():
                sanitized[key] = sanitize_url(value) or value
            else:
                # Default string sanitization
                # Use reasonable max length based on field type
                max_length = 10000 if "description" in key.lower() or "notes" in key.lower() or "query" in key.lower() else 1000
                sanitized[key] = sanitize_string(value, max_length=max_length)
        elif isinstance(value, dict):
            # Recursively sanitize nested dictionaries
            sanitized[key] = sanitize_dict(value)
        elif isinstance(value, list):
            # Sanitize list items
            sanitized[key] = [
                sanitize_dict(item) if isinstance(item, dict) else
                sanitize_string(item, max_length=1000) if isinstance(item, str) else item
                for item in value
            ]
        else:
            sanitized[key] = value
    
    return sanitized


def sanitize_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively sanitize a dictionary."""
    sanitized = {}
    for key, value in data.items():
        if isinstance(value, str):
            if "email" in key.lower():
                sanitized[key] = sanitize_email(value) or value
            elif "url" in key.lower() or "uri" in key.lower():
                sanitized[key] = sanitize_url(value) or value
            else:
                max_length = 10000 if "description" in key.lower() or "notes" in key.lower() else 1000
                sanitized[key] = sanitize_string(value, max_length=max_length)
        elif isinstance(value, dict):
            sanitized[key] = sanitize_dict(value)
        elif isinstance(value, list):
            sanitized[key] = [
                sanitize_dict(item) if isinstance(item, dict) else
                sanitize_string(item, max_length=1000) if isinstance(item, str) else item
                for item in value
            ]
        else:
            sanitized[key] = value
    return sanitized
