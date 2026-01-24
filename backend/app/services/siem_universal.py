import json
from typing import List, Optional, Dict, Any

from .. import models
from ..schemas import SIEMAlert, SIEMEvent, SIEMRule, SIEMHealth
from ..services.siem_connectors import SplunkConnector, SentinelConnector, _parse_credentials


class SIEMUniversalService:
    """
    Universal SIEM adapter for core PurveX use-cases:
    - Alerts/detections
    - Telemetry/events
    - Rule inventory (optional)
    - Health/status

    SECURITY:
    - Never returns credentials.
    - Redacts raw events to avoid large payloads and PII leakage.
    - Returns minimal normalized fields.
    """

    def __init__(self, connection: models.SIEMConnection):
        self.connection = connection
        self.credentials = _parse_credentials(connection.credentials)
        self.siem_type = (connection.siem_type or "").strip().lower()

    def has_credentials(self) -> bool:
        return bool(self.credentials)

    async def get_alerts(self, limit: int = 50) -> List[SIEMAlert]:
        if not self.has_credentials():
            return []
        if self.siem_type == "splunk":
            return await SplunkConnector(self.connection.url, self.credentials).get_alerts(limit)
        if self.siem_type == "sentinel":
            return await SentinelConnector(self.credentials).get_alerts(limit)
        return []

    async def get_events(self, limit: int = 100) -> List[SIEMEvent]:
        if not self.has_credentials():
            return []
        if self.siem_type == "splunk":
            return await SplunkConnector(self.connection.url, self.credentials).get_events(limit)
        if self.siem_type == "sentinel":
            return await SentinelConnector(self.credentials).get_events(limit)
        return []

    async def get_rules(self, limit: int = 200) -> List[SIEMRule]:
        if not self.has_credentials():
            return []
        if self.siem_type == "splunk":
            return await SplunkConnector(self.connection.url, self.credentials).get_rules(limit)
        if self.siem_type == "sentinel":
            return await SentinelConnector(self.credentials).get_rules(limit)
        return []

    async def get_health(self) -> SIEMHealth:
        if not self.connection:
            return SIEMHealth(status="not_configured", auth_status="missing_connection")

        if not self.has_credentials():
            return SIEMHealth(
                status="not_configured",
                auth_status="missing_credentials",
                message="Credentials not supplied. Add a token or service principal to enable SIEM queries.",
            )

        if self.siem_type == "splunk":
            health = await SplunkConnector(self.connection.url, self.credentials).health()
        elif self.siem_type == "sentinel":
            health = await SentinelConnector(self.credentials).health()
        else:
            health = {"status": "configured", "auth_status": "not_supported", "message": "Unsupported SIEM type"}
        return SIEMHealth(**health)

    def to_connection_response(self) -> Dict[str, Any]:
        return {
            "id": self.connection.id,
            "organization_id": self.connection.organization_id,
            "siem_type": self.connection.siem_type,
            "name": self.connection.name,
            "url": self.connection.url,
            "auth_type": self.connection.auth_type,
            "credentials": None,
            "credentials_present": self.has_credentials(),
            "status": "configured" if self.has_credentials() else "not_configured",
            "last_validated_at": self.connection.last_validated_at,
            "default_windows_index": self.connection.default_windows_index,
            "default_linux_index": self.connection.default_linux_index,
            "default_cloud_index": self.connection.default_cloud_index,
            "log_marker_pattern": self.connection.log_marker_pattern,
        }
