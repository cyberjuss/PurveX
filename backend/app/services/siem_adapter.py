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


_SPLUNK_TYPES = {"splunk", "splunk es", "splunk_es", "splunk-es"}
_ELASTIC_TYPES = {"elastic", "elasticsearch", "elastic security", "elastic_security", "kibana"}
_SENTINEL_TYPES = {"sentinel", "microsoft sentinel", "azure sentinel"}


class ElasticAdapter:
    """Synchronous Elastic Security adapter for the scoring pipeline.

    Queries the signals/events index via the Kibana console proxy. Events are
    normalized so `_time` matches the shape produced by SplunkAdapter, keeping
    downstream scoring logic SIEM-agnostic.
    """

    def __init__(
        self,
        base_url: Optional[str],
        credentials: Dict[str, str],
    ):
        self.base_url = (base_url or "").rstrip("/")
        self.credentials = credentials or {}
        self.verify_ssl = _as_bool(self.credentials.get("verify_ssl"), default=True)
        self.timeout_seconds = float(self.credentials.get("timeout_seconds", 30))
        self.events_index = self.credentials.get("events_index") or "logs-*"

    @classmethod
    def from_connection(cls, connection: models.SIEMConnection) -> "ElasticAdapter":
        return cls(connection.url, _parse_credentials(connection.credentials))

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", "kbn-xsrf": "purvex"}
        api_key = self.credentials.get("api_key") or self.credentials.get("token")
        if api_key:
            headers["Authorization"] = f"ApiKey {api_key}"
        return headers

    def _auth(self):
        if self.credentials.get("api_key") or self.credentials.get("token"):
            return None
        username = self.credentials.get("username")
        password = self.credentials.get("password")
        if username and password:
            return (username, password)
        return None

    def _ensure_configured(self) -> None:
        if not self.base_url:
            raise RuntimeError("Elastic/Kibana URL is not configured.")
        if not (self.credentials.get("api_key") or self.credentials.get("token") or self._auth()):
            raise RuntimeError("Elastic credentials are not configured.")

    def search_events(self, query: str, earliest: datetime, latest: datetime) -> List[Dict]:
        self._ensure_configured()
        body = {
            "size": 200,
            "sort": [{"@timestamp": {"order": "desc"}}],
            "query": {
                "bool": {
                    "must": [{"query_string": {"query": query or "*"}}],
                    "filter": [
                        {
                            "range": {
                                "@timestamp": {
                                    "gte": _coerce_datetime(earliest).isoformat(),
                                    "lte": _coerce_datetime(latest).isoformat(),
                                }
                            }
                        }
                    ],
                }
            },
        }
        url = f"{self.base_url}/api/console/proxy?path=/{self.events_index}/_search&method=POST"
        response = requests.post(
            url,
            json=body,
            headers=self._headers(),
            auth=self._auth(),
            verify=self.verify_ssl,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        data = response.json() if response.content else {}
        hits = (data.get("hits") or {}).get("hits") or []
        results: List[Dict] = []
        for hit in hits:
            src = hit.get("_source") or {}
            normalized = dict(src)
            normalized["_time"] = src.get("@timestamp")
            results.append(normalized)
        logger.info("Elastic search returned %s events", len(results))
        return results


class SentinelAdapter:
    """Synchronous Microsoft Sentinel adapter using the Log Analytics query API."""

    def __init__(self, credentials: Dict[str, str]):
        self.credentials = credentials or {}
        self.timeout_seconds = float(self.credentials.get("timeout_seconds", 30))
        self.events_table = self.credentials.get("events_table") or "SecurityEvent"

    @classmethod
    def from_connection(cls, connection: models.SIEMConnection) -> "SentinelAdapter":
        return cls(_parse_credentials(connection.credentials))

    def _token(self, scope: str) -> str:
        tenant_id = self.credentials.get("tenant_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not (tenant_id and client_id and client_secret):
            raise RuntimeError("Sentinel credentials are not configured.")
        resp = requests.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": scope,
                "grant_type": "client_credentials",
            },
            timeout=self.timeout_seconds,
        )
        resp.raise_for_status()
        return resp.json()["access_token"]

    def _ensure_configured(self) -> None:
        if not self.credentials.get("workspace_id"):
            raise RuntimeError("Sentinel workspace_id is not configured.")

    def search_events(self, query: str, earliest: datetime, latest: datetime) -> List[Dict]:
        self._ensure_configured()
        workspace_id = self.credentials["workspace_id"]
        token = self._token("https://api.loganalytics.io/.default")

        start_iso = _coerce_datetime(earliest).isoformat()
        end_iso = _coerce_datetime(latest).isoformat()
        timespan = f"{start_iso}/{end_iso}"

        # Treat `query` as a free-text match against the default events table,
        # unless it's a full KQL statement (starts with a table name).
        text = (query or "").strip()
        if text and text.split()[0].isidentifier() and "|" in text:
            kql = text
        else:
            safe = text.replace('"', '\\"') if text else ""
            kql = f'{self.events_table} | where * contains "{safe}" | sort by TimeGenerated desc | take 200'

        resp = requests.post(
            f"https://api.loganalytics.io/v1/workspaces/{workspace_id}/query",
            headers={"Authorization": f"Bearer {token}"},
            json={"query": kql, "timespan": timespan},
            timeout=self.timeout_seconds,
        )
        resp.raise_for_status()
        data = resp.json()
        tables = data.get("tables") or []
        if not tables:
            return []
        cols = [c["name"] for c in tables[0].get("columns", [])]
        rows = tables[0].get("rows", [])
        results: List[Dict] = []
        for row in rows:
            record = dict(zip(cols, row))
            record["_time"] = record.get("TimeGenerated")
            results.append(record)
        logger.info("Sentinel search returned %s events", len(results))
        return results


def get_siem_adapter(connection: Optional[models.SIEMConnection] = None):
    if connection is not None:
        siem_type = (connection.siem_type or "").strip().lower()
        if siem_type in _SPLUNK_TYPES:
            return SplunkAdapter.from_connection(connection)
        if siem_type in _ELASTIC_TYPES:
            return ElasticAdapter.from_connection(connection)
        if siem_type in _SENTINEL_TYPES:
            return SentinelAdapter.from_connection(connection)
        raise ValueError(f"Unsupported SIEM type: {connection.siem_type}")

    siem_type = (getattr(settings, "SIEM_TYPE", "splunk") or "").strip().lower()
    if siem_type in _SPLUNK_TYPES:
        return SplunkAdapter(
            getattr(settings, "SPLUNK_URL", None),
            getattr(settings, "SPLUNK_USERNAME", None),
            getattr(settings, "SPLUNK_PASSWORD", None),
            getattr(settings, "SPLUNK_TOKEN", None),
        )
    raise ValueError(f"Unsupported SIEM type: {siem_type}")
