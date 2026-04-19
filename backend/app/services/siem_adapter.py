import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

import requests

from .. import models
from ..config import settings

logger = logging.getLogger(__name__)


def _coerce_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_credentials(raw: Optional[str]) -> Dict[str, str]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {"token": raw}


def _as_bool(value: object, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


class SplunkAdapter:
    def __init__(
        self,
        splunk_url: Optional[str] = None,
        splunk_username: Optional[str] = None,
        splunk_password: Optional[str] = None,
        splunk_token: Optional[str] = None,
        verify_ssl: bool = True,
        timeout_seconds: float = 30.0,
    ):
        self.splunk_url = (splunk_url or "").rstrip("/")
        self.splunk_username = splunk_username
        self.splunk_password = splunk_password
        self.splunk_token = splunk_token
        self.verify_ssl = verify_ssl
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_connection(cls, connection: models.SIEMConnection) -> "SplunkAdapter":
        credentials = _parse_credentials(connection.credentials)
        return cls(
            splunk_url=connection.url,
            splunk_username=credentials.get("username"),
            splunk_password=credentials.get("password"),
            splunk_token=credentials.get("token") or credentials.get("splunk_token"),
            verify_ssl=_as_bool(credentials.get("verify_ssl"), default=True),
            timeout_seconds=float(credentials.get("timeout_seconds", 30)),
        )

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        if self.splunk_token:
            headers["Authorization"] = f"Splunk {self.splunk_token}"
        return headers

    def _auth(self):
        if self.splunk_username and self.splunk_password:
            return (self.splunk_username, self.splunk_password)
        return None

    def _ensure_configured(self) -> None:
        if not self.splunk_url:
            raise RuntimeError("Splunk URL is not configured.")
        if not self.splunk_token and not self._auth():
            raise RuntimeError("Splunk credentials are not configured.")

    def search_events(self, query: str, earliest: datetime, latest: datetime) -> List[Dict]:
        self._ensure_configured()

        search = query.strip()
        if not search.lower().startswith(("search ", "|")):
            search = f"search {search}"

        payload = {
            "output_mode": "json",
            "search": search,
            "earliest_time": str(int(_coerce_datetime(earliest).timestamp())),
            "latest_time": str(int(_coerce_datetime(latest).timestamp())),
        }
        url = f"{self.splunk_url}/services/search/jobs/export"

        response = requests.post(
            url,
            data=payload,
            headers=self._headers(),
            auth=self._auth(),
            verify=self.verify_ssl,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()

        results: List[Dict] = []
        for line in response.text.splitlines():
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            result = entry.get("result")
            if not isinstance(result, dict):
                continue
            event_time = result.get("_time")
            if isinstance(event_time, (int, float)) or (
                isinstance(event_time, str) and event_time.replace(".", "", 1).isdigit()
            ):
                try:
                    result["_time"] = datetime.fromtimestamp(float(event_time), tz=timezone.utc).isoformat()
                except Exception:
                    pass
            results.append(result)

        logger.info("Splunk search returned %s events", len(results))
        return results


def get_siem_adapter(connection: Optional[models.SIEMConnection] = None):
    if connection is not None:
        if (connection.siem_type or "").strip().lower() != "splunk":
            raise ValueError(f"Unsupported SIEM type: {connection.siem_type}")
        return SplunkAdapter.from_connection(connection)

    siem_type = getattr(settings, "SIEM_TYPE", "splunk")
    if siem_type == "splunk":
        return SplunkAdapter(
            getattr(settings, "SPLUNK_URL", None),
            getattr(settings, "SPLUNK_USERNAME", None),
            getattr(settings, "SPLUNK_PASSWORD", None),
            getattr(settings, "SPLUNK_TOKEN", None),
        )
    raise ValueError(f"Unsupported SIEM type: {siem_type}")
