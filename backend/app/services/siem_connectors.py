import json
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_credentials(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    # If user pasted a raw token, accept it as token
    return {"token": value}


def _as_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return default


def _limit(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(max_value, value))


def _safe_text(value: Optional[str], max_len: int = 2000) -> Optional[str]:
    if not value:
        return None
    trimmed = value.strip()
    if len(trimmed) > max_len:
        return trimmed[: max_len - 3] + "..."
    return trimmed


class SplunkConnector:
    def __init__(self, base_url: str, credentials: Dict[str, Any]):
        self.base_url = (base_url or "").rstrip("/")
        self.credentials = credentials
        self.verify_ssl = _as_bool(credentials.get("verify_ssl", True), default=True)
        self.timeout = float(credentials.get("timeout_seconds", 15))
        self.web_url = (credentials.get("web_url") or self.base_url).rstrip("/")

    def _headers(self) -> Dict[str, str]:
        token = self.credentials.get("token") or self.credentials.get("splunk_token")
        if token:
            return {"Authorization": f"Splunk {token}"}
        return {}

    def _auth(self) -> Optional[Tuple[str, str]]:
        username = self.credentials.get("username")
        password = self.credentials.get("password")
        if username and password:
            return (username, password)
        return None

    async def _request(self, method: str, path: str, params: Optional[Dict[str, Any]] = None, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            response = await client.request(
                method,
                url,
                params=params,
                data=data,
                headers=self._headers(),
                auth=self._auth(),
            )
            response.raise_for_status()
            if response.text:
                return response.json()
        return {}

    async def health(self) -> Dict[str, Any]:
        if not self.base_url:
            return {"status": "not_configured", "auth_status": "missing_url"}
        if not (self.credentials.get("token") or self._auth()):
            return {"status": "not_configured", "auth_status": "missing_credentials"}
        try:
            await self._request("GET", "/services/server/info", params={"output_mode": "json"})
            return {"status": "connected", "auth_status": "ok"}
        except Exception as exc:
            return {"status": "error", "auth_status": "failed", "message": str(exc)}

    async def get_rules(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 500)
        payload = await self._request(
            "GET",
            "/services/saved/searches",
            params={"output_mode": "json", "count": str(limit)},
        )
        entries = payload.get("entry", []) if isinstance(payload, dict) else []
        rules = []
        for entry in entries:
            content = entry.get("content", {})
            rules.append(
                {
                    "rule_id": entry.get("name"),
                    "name": entry.get("name"),
                    "enabled": content.get("disabled") is False,
                    "severity": content.get("alert.severity"),
                    "schedule": content.get("cron_schedule"),
                    "last_run_at": content.get("last_run"),
                    "query": content.get("search"),
                    "evidence_url": f"{self.web_url}/app/search/search?search={httpx.QueryParams({'q': entry.get('name')}).get('q')}",
                }
            )
        return rules

    async def get_alerts(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 200)
        payload = await self._request(
            "GET",
            "/services/alerts/fired",
            params={"output_mode": "json", "count": str(limit)},
        )
        entries = payload.get("entry", []) if isinstance(payload, dict) else []
        alerts = []
        for entry in entries:
            content = entry.get("content", {})
            alerts.append(
                {
                    "alert_id": entry.get("id"),
                    "rule_id": entry.get("name"),
                    "rule_name": entry.get("name"),
                    "severity": content.get("severity"),
                    "status": content.get("status") or content.get("digest_mode"),
                    "fired_at": content.get("trigger_time"),
                    "last_seen_at": content.get("trigger_time"),
                    "source": "splunk",
                    "raw_event": _safe_text(content.get("reason")),
                    "evidence_url": f"{self.web_url}/app/search/search?search={httpx.QueryParams({'sid': content.get('sid')}).get('sid')}" if content.get("sid") else None,
                }
            )
        return alerts

    async def get_events(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 200)
        default_query = self.credentials.get("events_query") or "search index=_internal | head 100"
        earliest = self.credentials.get("events_earliest") or "-24h"
        latest = self.credentials.get("events_latest") or "now"
        query = f"{default_query} | head {limit}"
        payload = await self._request(
            "POST",
            "/services/search/jobs/export",
            params={"output_mode": "json", "search": query, "earliest_time": earliest, "latest_time": latest},
        )
        # export returns JSON lines; fallback to empty list if not parseable
        events: List[Dict[str, Any]] = []
        if isinstance(payload, dict) and payload.get("result"):
            result = payload.get("result")
            if isinstance(result, dict):
                events.append(
                    {
                        "event_id": result.get("_raw") or result.get("_time"),
                        "event_time": result.get("_time"),
                        "severity": result.get("severity"),
                        "source": "splunk",
                        "host": result.get("host"),
                        "user": result.get("user"),
                        "action": result.get("action"),
                        "raw_event": _safe_text(result.get("_raw")),
                        "evidence_url": None,
                    }
                )
        return events


class SentinelConnector:
    def __init__(self, credentials: Dict[str, Any]):
        self.credentials = credentials
        self.timeout = float(credentials.get("timeout_seconds", 15))

    async def _token(self, scope: str) -> str:
        tenant_id = self.credentials.get("tenant_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not (tenant_id and client_id and client_secret):
            raise ValueError("Missing tenant_id/client_id/client_secret")
        token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": scope,
            "grant_type": "client_credentials",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(token_url, data=data)
            resp.raise_for_status()
            return resp.json()["access_token"]

    async def _log_analytics_query(self, kql: str, timespan: str = "PT24H") -> Dict[str, Any]:
        workspace_id = self.credentials.get("workspace_id")
        if not workspace_id:
            raise ValueError("Missing workspace_id")
        token = await self._token("https://api.loganalytics.io/.default")
        url = f"https://api.loganalytics.io/v1/workspaces/{workspace_id}/query"
        headers = {"Authorization": f"Bearer {token}"}
        payload = {"query": kql, "timespan": timespan}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json()

    async def _management_request(self, path: str) -> Dict[str, Any]:
        token = await self._token("https://management.azure.com/.default")
        url = f"https://management.azure.com{path}"
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()

    async def health(self) -> Dict[str, Any]:
        try:
            await self._token("https://api.loganalytics.io/.default")
            return {"status": "connected", "auth_status": "ok"}
        except Exception as exc:
            return {"status": "error", "auth_status": "failed", "message": str(exc)}

    async def get_alerts(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 200)
        kql = self.credentials.get("alerts_kql") or f"SecurityAlert | sort by TimeGenerated desc | take {limit}"
        data = await self._log_analytics_query(kql)
        rows = data.get("tables", [{}])[0].get("rows", [])
        cols = [c["name"] for c in data.get("tables", [{}])[0].get("columns", [])]
        alerts = []
        for row in rows:
            record = dict(zip(cols, row))
            alerts.append(
                {
                    "alert_id": record.get("SystemAlertId") or record.get("AlertId"),
                    "rule_id": record.get("AlertRuleId"),
                    "rule_name": record.get("AlertName") or record.get("DisplayName"),
                    "severity": record.get("Severity"),
                    "status": record.get("Status"),
                    "fired_at": record.get("TimeGenerated"),
                    "last_seen_at": record.get("TimeGenerated"),
                    "source": "sentinel",
                    "raw_event": _safe_text(record.get("Description") or record.get("AlertDescription")),
                    "evidence_url": record.get("ProviderAlertLink"),
                }
            )
        return alerts

    async def get_events(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 200)
        table = self.credentials.get("events_table") or "SecurityEvent"
        kql = self.credentials.get("events_kql") or f"{table} | sort by TimeGenerated desc | take {limit}"
        data = await self._log_analytics_query(kql)
        rows = data.get("tables", [{}])[0].get("rows", [])
        cols = [c["name"] for c in data.get("tables", [{}])[0].get("columns", [])]
        events = []
        for row in rows:
            record = dict(zip(cols, row))
            events.append(
                {
                    "event_id": record.get("EventID") or record.get("_ItemId"),
                    "event_time": record.get("TimeGenerated"),
                    "severity": record.get("Level") or record.get("Severity"),
                    "source": "sentinel",
                    "host": record.get("Computer") or record.get("DeviceName"),
                    "user": record.get("Account") or record.get("SubjectUserName"),
                    "action": record.get("Activity") or record.get("EventData"),
                    "raw_event": _safe_text(json.dumps(record, default=str)),
                    "evidence_url": None,
                }
            )
        return events

    async def get_rules(self, limit: int) -> List[Dict[str, Any]]:
        subscription_id = self.credentials.get("subscription_id")
        resource_group = self.credentials.get("resource_group")
        workspace_name = self.credentials.get("workspace_name")
        if not (subscription_id and resource_group and workspace_name):
            return []
        path = (
            f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.OperationalInsights/workspaces/{workspace_name}"
            f"/providers/Microsoft.SecurityInsights/alertRules?api-version=2023-02-01-preview"
        )
        data = await self._management_request(path)
        rules = []
        for item in data.get("value", []):
            props = item.get("properties", {})
            rules.append(
                {
                    "rule_id": item.get("name"),
                    "name": props.get("displayName"),
                    "enabled": props.get("enabled"),
                    "severity": props.get("severity"),
                    "schedule": props.get("queryFrequency"),
                    "last_run_at": props.get("lastModifiedUtc"),
                    "query": props.get("query"),
                    "evidence_url": None,
                }
            )
        return rules
