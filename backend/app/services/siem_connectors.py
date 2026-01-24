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
        self.es_app = credentials.get("es_app") or "SplunkEnterpriseSecurity"
        self.notable_index = credentials.get("notable_index") or "notable"
        self.alerts_mode = (credentials.get("alerts_mode") or "alerts_fired").strip().lower()
        self.alerts_index = credentials.get("alerts_index") or ""
        self.host_field = credentials.get("host_field") or "host"
        self.user_field = credentials.get("user_field") or "user"
        self.dest_field = credentials.get("dest_field") or "dest"
        self.src_field = credentials.get("src_field") or "src"
        self.signature_field = credentials.get("signature_field") or "signature"

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

    async def _export_search(self, search: str, earliest: str, latest: str, limit: int) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/services/search/jobs/export"
        payload = {
            "output_mode": "json",
            "search": search,
            "earliest_time": earliest,
            "latest_time": latest,
        }
        results: List[Dict[str, Any]] = []
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            headers = self._headers()
            headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
            response = await client.post(url, data=payload, headers=headers, auth=self._auth())
            response.raise_for_status()
            for line in response.text.splitlines():
                try:
                    payload = json.loads(line)
                except Exception:
                    continue
                if "result" in payload and isinstance(payload["result"], dict):
                    results.append(payload["result"])
                    if len(results) >= limit:
                        break
        return results

    def _build_search_link(self, search: str, earliest: Optional[str] = None, latest: Optional[str] = None) -> str:
        params = {"search": search}
        if earliest:
            params["earliest"] = earliest
        if latest:
            params["latest"] = latest
        return f"{self.web_url}/app/search/search?{httpx.QueryParams(params)}"

    async def health(self) -> Dict[str, Any]:
        if not self.base_url:
            return {"status": "not_configured", "auth_status": "missing_url"}
        if not (self.credentials.get("token") or self._auth()):
            return {"status": "not_configured", "auth_status": "missing_credentials"}
        try:
            await self._request("GET", "/services/server/info", params={"output_mode": "json"})
            last_alert_at = None
            ingestion_lag_seconds = None
            try:
                search = f"search index={self.notable_index} | sort -_time | head 1 | fields _time"
                results = await self._export_search(search, "-24h", "now", 1)
                if results:
                    last_alert_at = results[0].get("_time")
            except Exception:
                pass
            if last_alert_at:
                try:
                    alert_time = datetime.fromtimestamp(float(last_alert_at), tz=timezone.utc)
                    ingestion_lag_seconds = int((_now_utc() - alert_time).total_seconds())
                except Exception:
                    ingestion_lag_seconds = None
            return {
                "status": "connected",
                "auth_status": "ok",
                "last_alert_at": last_alert_at,
                "ingestion_lag_seconds": ingestion_lag_seconds,
            }
        except Exception as exc:
            return {"status": "error", "auth_status": "failed", "message": str(exc)}

    async def get_rules(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 500)
        payload = {}
        try:
            payload = await self._request(
                "GET",
                f"/servicesNS/-/{self.es_app}/saved/searches",
                params={"output_mode": "json", "count": str(limit)},
            )
        except Exception:
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
                    "evidence_url": self._build_search_link(entry.get("name") or ""),
                }
            )
        return rules

    async def get_alerts(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 200)
        if self.alerts_mode == "alerts_index" and self.alerts_index:
            search = (
                f"search index={self.alerts_index} "
                f"| sort -_time | head {limit} "
                f"| fields _time alert_id rule_name search_name severity status "
                f"{self.host_field} {self.user_field} {self.dest_field} {self.src_field} {self.signature_field}"
            )
            entries = await self._export_search(search, "-24h", "now", limit)
            alerts = []
            for entry in entries:
                rule_name = entry.get("rule_name") or entry.get("search_name")
                alert_id = entry.get("alert_id") or entry.get("event_id") or entry.get("_time")
                earliest = entry.get("_time")
                latest = entry.get("_time")
                link_query = f'search index={self.alerts_index} {self.signature_field}="{entry.get(self.signature_field)}"' if entry.get(self.signature_field) else f"search index={self.alerts_index}"
                alerts.append(
                    {
                        "alert_id": alert_id,
                        "rule_id": rule_name,
                        "rule_name": rule_name,
                        "severity": entry.get("severity"),
                        "status": entry.get("status"),
                        "fired_at": entry.get("_time"),
                        "last_seen_at": entry.get("_time"),
                        "source": "splunk",
                        "raw_event": _safe_text(entry.get(self.signature_field)),
                        "evidence_url": self._build_search_link(link_query, earliest=earliest, latest=latest),
                    }
                )
            return alerts

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
                    "evidence_url": self._build_search_link(entry.get("name") or ""),
                }
            )
        return alerts

    async def get_events(self, limit: int) -> List[Dict[str, Any]]:
        limit = _limit(limit, 1, 200)
        earliest = self.credentials.get("events_earliest") or "-24h"
        latest = self.credentials.get("events_latest") or "now"
        base_index = self.alerts_index if (self.alerts_mode == "alerts_index" and self.alerts_index) else self.notable_index
        query = (
            f"search index={base_index} "
            f"| sort -_time | head {limit} "
            f"| fields _time {self.host_field} {self.user_field} {self.dest_field} {self.src_field} {self.signature_field} severity"
        )
        payload = await self._export_search(query, earliest, latest, limit)
        events: List[Dict[str, Any]] = []
        for result in payload:
            events.append(
                {
                    "event_id": result.get("notable_id") or result.get("event_id") or result.get("_time"),
                    "event_time": result.get("_time"),
                    "severity": result.get("severity"),
                    "source": "splunk",
                    "host": result.get(self.host_field),
                    "user": result.get(self.user_field),
                    "action": result.get(self.signature_field),
                    "raw_event": _safe_text(result.get(self.signature_field)),
                    "evidence_url": None,
                }
            )
        return events

    async def get_evidence(
        self,
        earliest: str,
        latest: str,
        host: Optional[str] = None,
        user: Optional[str] = None,
        dest: Optional[str] = None,
        src: Optional[str] = None,
        limit: int = 50,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        limit = _limit(limit, 1, 200)
        base_index = self.alerts_index if (self.alerts_mode == "alerts_index" and self.alerts_index) else self.notable_index
        filters = []
        if host:
            filters.append(f'{self.host_field}="{host}"')
        if user:
            filters.append(f'{self.user_field}="{user}"')
        if dest:
            filters.append(f'{self.dest_field}="{dest}"')
        if src:
            filters.append(f'{self.src_field}="{src}"')
        filter_block = f"({ ' OR '.join(filters) })" if filters else ""
        search = (
            f"search index={base_index} "
            f"{filter_block} "
            f"| sort -_time | head {limit} "
            f"| fields _time severity {self.host_field} {self.user_field} "
            f"{self.dest_field} {self.src_field} {self.signature_field} sourcetype index"
        ).strip()
        results = await self._export_search(search, earliest, latest, limit)
        items = []
        for result in results:
            items.append(
                {
                    "event_time": result.get("_time"),
                    "severity": result.get("severity"),
                    "host": result.get(self.host_field),
                    "user": result.get(self.user_field),
                    "dest": result.get(self.dest_field),
                    "src": result.get(self.src_field),
                    "signature": result.get(self.signature_field),
                    "sourcetype": result.get("sourcetype"),
                    "index": result.get("index"),
                }
            )
        deep_link = self._build_search_link(search, earliest=earliest, latest=latest)
        return items, deep_link


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
