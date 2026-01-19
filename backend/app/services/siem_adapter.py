import requests
import json
from datetime import datetime
from typing import List, Dict, Optional

from ..config import settings

class SplunkAdapter:
    def __init__(
        self,
        splunk_url: Optional[str] = None,
        splunk_username: Optional[str] = None,
        splunk_password: Optional[str] = None,
        splunk_token: Optional[str] = None,
    ):
        # For the current MVP we operate in "stub" mode unless real config is provided.
        self.splunk_url = (splunk_url or "").rstrip("/")
        self.splunk_username = splunk_username
        self.splunk_password = splunk_password
        self.splunk_token = splunk_token

    def search_events(self, query: str, earliest: datetime, latest: datetime) -> List[Dict]:
        # *** STUBBED FOR MVP DEMO ***
        # In a real scenario, this would call the Splunk search API.
        print(f"[STUB] Searching Splunk with query: {query}, earliest: {earliest}, latest: {latest}")

        # Simulate events for demonstration purposes
        if "PASS_MARKER" in query:
            return [
                {"_time": earliest.isoformat(), "event": f"Detection event for {query} at {datetime.utcnow()}", "marker": "PASS_MARKER"},
                {"_time": earliest.isoformat(), "event": f"Another event for {query}", "marker": "PASS_MARKER"},
            ]
        elif "FAIL_MARKER" in query:
            return [
                {"_time": earliest.isoformat(), "event": f"Telemetry event for {query} at {datetime.utcnow()}", "marker": "FAIL_MARKER"},
            ]
        else:
            # Default to no events for other markers to simulate INCONCLUSIVE/FAIL
            return []

def get_siem_adapter():
    # For v1 we default to a Splunk adapter in stub mode when full config
    # is not present. This keeps the pipeline working while you wire up
    # real Splunk credentials later.
    siem_type = getattr(settings, "SIEM_TYPE", "splunk")
    if siem_type == "splunk":
        return SplunkAdapter(
            getattr(settings, "SPLUNK_URL", None),
            getattr(settings, "SPLUNK_USERNAME", None),
            getattr(settings, "SPLUNK_PASSWORD", None),
            getattr(settings, "SPLUNK_TOKEN", None),
        )
    raise ValueError(f"Unsupported SIEM type: {siem_type}")
