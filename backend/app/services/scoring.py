# This file will contain logic for scoring detections.

from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Any
import zlib
import logging

from .. import models
from .siem_adapter import get_siem_adapter

logger = logging.getLogger(__name__)


# =============================================================================
# SIEM latency / validation scoring (existing logic)
# =============================================================================


# Simple, static latency expectations for the MVP. In a future version these
# can be pulled from EnvironmentRunnerConfig or TestingPolicy.
TELEMETRY_IDEAL_LATENCY_SECONDS = 30
TELEMETRY_MAX_LATENCY_SECONDS = 600
DETECTION_IDEAL_LATENCY_SECONDS = 60
DETECTION_MAX_LATENCY_SECONDS = 900


def _safe_latency_seconds(event_time: Optional[str], reference: datetime) -> Optional[float]:
    """Parse an event time string and return latency in seconds, or None if unknown."""
    if not event_time:
        return None
    try:
        # Splunk stub uses ISO timestamps; in real adapters we can normalise here.
        dt = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        return max(0.0, (dt - reference).total_seconds())
    except Exception:
        return None


def _metric_latency(latency: Optional[float], ideal: int, maximum: int) -> float:
    """Convert a latency in seconds into a 0–1 score based on ideal/max thresholds."""
    if latency is None:
        # Neutral‑good default when latency exists but is not measured explicitly.
        return 0.7
    if latency <= ideal:
        return 1.0
    if latency >= maximum:
        return 0.0
    # Linear scale between ideal and max.
    return max(
        0.0,
        min(1.0, (maximum - latency) / float(maximum - ideal)),
    )


def _collect_telemetry_and_detection_events(
    test: models.Test,
    detection: Optional[models.Detection] = None,
    siem_connection: Optional[models.SIEMConnection] = None,
) -> Tuple[bool, bool, bool, bool, int, int, List[Dict], List[Dict], Optional[float], Optional[float]]:
    """Shared helper to query the SIEM for telemetry + (optional) detection events."""
    siem_adapter = get_siem_adapter(siem_connection)

    earliest = test.started_at - timedelta(minutes=2)
    latest = datetime.utcnow() + timedelta(minutes=2)
    marker = test.marker

    system_error = False

    try:
        telemetry_q = f'"{marker}"'
        telemetry_events = siem_adapter.search_events(telemetry_q, earliest, latest)
    except Exception:
        telemetry_events = []
        system_error = True

    detection_events: List[Dict] = []
    if detection is not None:
        try:
            detection_q = detection.siem_query
            if marker and "{{MARKER}}" in detection_q:
                detection_q = detection_q.replace("{{MARKER}}", marker)
            detection_events = siem_adapter.search_events(detection_q, earliest, latest)
        except Exception:
            detection_events = []
            system_error = True

    found_events_count = len(telemetry_events)
    detection_events_count = len(detection_events)

    has_telemetry = found_events_count > 0
    detection_linked = detection is not None
    detection_fired = detection_events_count > 0

    telemetry_first_time = telemetry_events[0].get("_time") if telemetry_events else None
    detection_first_time = detection_events[0].get("_time") if detection_events else None

    telemetry_ingestion_latency_seconds = (
        _safe_latency_seconds(telemetry_first_time, test.started_at) if telemetry_first_time else None
    )

    detection_latency_seconds: Optional[float] = None
    if telemetry_first_time and detection_first_time:
        try:
            t0 = datetime.fromisoformat(telemetry_first_time.replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(detection_first_time.replace("Z", "+00:00"))
            detection_latency_seconds = max(0.0, (t1 - t0).total_seconds())
        except Exception:
            detection_latency_seconds = None

    return (
        system_error,
        has_telemetry,
        detection_linked,
        detection_fired,
        found_events_count,
        detection_events_count,
        telemetry_events,
        detection_events,
        telemetry_ingestion_latency_seconds,
        detection_latency_seconds,
    )


def validate_detection_for_test(
    test: models.Test,
    detection: models.Detection,
    siem_connection: Optional[models.SIEMConnection] = None,
) -> Tuple[str, int, List[Dict]]:
    """Validate a detection by checking telemetry + detection events and compute a 0‑100 score.

    Returns:
        result: str  - high level outcome mapped to PASS / FAIL / INCONCLUSIVE for compatibility.
        score: int   - unified 0‑100 numeric score.
        sample_events: list[dict] - small sample of SIEM events.
    """

    # --- 1. Collect raw data from SIEM -------------------------------------------------------

    (
        system_error,
        has_telemetry,
        detection_linked,
        detection_fired,
        found_events_count,
        detection_events_count,
        telemetry_events,
        detection_events,
        telemetry_ingestion_latency_seconds,
        detection_latency_seconds,
    ) = _collect_telemetry_and_detection_events(test, detection, siem_connection)

    # --- 2. Derive booleans and basic counts -------------------------------------------------

    expected_events_count: Optional[int] = None  # Template‑driven later; unknown for now.

    # --- 3. Classify into logical result types -----------------------------------------------

    if system_error:
        result_type = "INCONCLUSIVE_SYSTEM_ERROR"
    elif not has_telemetry:
        result_type = "NO_LOGS"
    elif detection_linked and detection_fired:
        result_type = "DETECTION_VALIDATED"
    elif detection_linked and not detection_fired:
        result_type = "RULE_VISIBILITY_ISSUE"
    else:
        # Future: telemetry‑only scenarios without a linked detection.
        result_type = "TELEMETRY_ONLY"

    # --- 4. Normalised metrics m1..m4 in [0,1] ----------------------------------------------

    # m1 – telemetry coverage
    if has_telemetry:
        if expected_events_count and expected_events_count > 0:
            coverage_ratio = found_events_count / float(expected_events_count)
            m1 = min(coverage_ratio, 1.0)
        else:
            # We don't know how many we "should" see, but we saw something.
            m1 = 0.5
    else:
        m1 = 0.0

    # m2 – telemetry speed
    if has_telemetry:
        m2 = _metric_latency(
            telemetry_ingestion_latency_seconds,
            TELEMETRY_IDEAL_LATENCY_SECONDS,
            TELEMETRY_MAX_LATENCY_SECONDS,
        )
    else:
        m2 = 0.0

    # m3 – detection fired
    if detection_linked:
        m3 = 1.0 if detection_fired else 0.0
    else:
        m3 = 0.0

    # m4 – detection speed
    if detection_linked and detection_fired:
        m4 = _metric_latency(
            detection_latency_seconds,
            DETECTION_IDEAL_LATENCY_SECONDS,
            DETECTION_MAX_LATENCY_SECONDS,
        )
    else:
        m4 = 0.0

    # --- 5. Weighted score -------------------------------------------------------------------

    w1, w2, w3, w4 = 0.35, 0.15, 0.30, 0.20
    raw_score_0_1 = w1 * m1 + w2 * m2 + w3 * m3 + w4 * m4
    numeric_score = round(100 * raw_score_0_1)

    # Tie score bands back to result_type where helpful.
    if result_type == "NO_LOGS":
        numeric_score = max(0, min(numeric_score, 20))
    elif result_type == "RULE_VISIBILITY_ISSUE":
        numeric_score = max(20, min(numeric_score, 60))
    elif result_type == "DETECTION_VALIDATED":
        numeric_score = max(70, min(numeric_score, 100))
    elif result_type == "INCONCLUSIVE_SYSTEM_ERROR":
        numeric_score = 15

    # --- 6. Map internal result_type back to legacy PASS / FAIL / INCONCLUSIVE --------------

    if result_type == "DETECTION_VALIDATED":
        legacy_result = "PASS"
    elif result_type == "RULE_VISIBILITY_ISSUE":
        legacy_result = "FAIL"
    else:
        # NO_LOGS, TELEMETRY_ONLY, INCONCLUSIVE_SYSTEM_ERROR
        legacy_result = "INCONCLUSIVE"

    # --- 7. Sample events for UI / AI --------------------------------------------------------

    sample_events = detection_events[:3] or telemetry_events[:3]

    return legacy_result, numeric_score, sample_events


def validate_telemetry_for_test(
    test: models.Test,
    siem_connection: Optional[models.SIEMConnection] = None,
) -> Tuple[str, int, List[Dict]]:
    """Telemetry‑only validation for scenario / coverage runs without a linked Detection."""

    (
        system_error,
        has_telemetry,
        _detection_linked,
        _detection_fired,
        found_events_count,
        _detection_events_count,
        telemetry_events,
        _detection_events,
        telemetry_ingestion_latency_seconds,
        _detection_latency_seconds,
    ) = _collect_telemetry_and_detection_events(test, None, siem_connection)

    expected_events_count: Optional[int] = None

    # --- Classify into result types for telemetry‑only flows ---------------------------------
    if system_error:
        result_type = "INCONCLUSIVE_SYSTEM_ERROR"
    elif not has_telemetry:
        result_type = "NO_LOGS"
    else:
        # We saw logs but don't have a specific rule to evaluate yet.
        result_type = "TELEMETRY_ONLY"

    # --- Metrics m1/m2 (telemetry); m3/m4 are not applicable ---------------------------------
    if has_telemetry:
        if expected_events_count and expected_events_count > 0:
            coverage_ratio = found_events_count / float(expected_events_count)
            m1 = min(coverage_ratio, 1.0)
        else:
            m1 = 0.5
    else:
        m1 = 0.0

    if has_telemetry:
        m2 = _metric_latency(
            telemetry_ingestion_latency_seconds,
            TELEMETRY_IDEAL_LATENCY_SECONDS,
            TELEMETRY_MAX_LATENCY_SECONDS,
        )
    else:
        m2 = 0.0

    m3 = 0.0
    m4 = 0.0

    w1, w2, w3, w4 = 0.35, 0.15, 0.30, 0.20
    raw_score_0_1 = w1 * m1 + w2 * m2 + w3 * m3 + w4 * m4
    numeric_score = round(100 * raw_score_0_1)

    if result_type == "NO_LOGS":
        numeric_score = max(0, min(numeric_score, 20))
    elif result_type == "TELEMETRY_ONLY":
        # For telemetry‑only we allow a wider healthy band.
        numeric_score = max(40, min(numeric_score, 90))
    elif result_type == "INCONCLUSIVE_SYSTEM_ERROR":
        numeric_score = 15

    if result_type == "TELEMETRY_ONLY":
        legacy_result = "PASS"
    elif result_type == "NO_LOGS":
        legacy_result = "INCONCLUSIVE"
    else:
        legacy_result = "INCONCLUSIVE"

    sample_events = telemetry_events[:3]

    return legacy_result, numeric_score, sample_events


# =============================================================================
# Detection quality scoring (C, T, F, E + 5W breakdown + optional ML)
# =============================================================================

GENERIC_VALUES = {"", "N/A", "UNKNOWN", "-", "NULL"}


def _is_meaningful(value: Any) -> bool:
    """Return True if a field value is non‑generic and carries signal."""
    if value is None:
        return False
    if isinstance(value, str):
        if value.strip() == "":
            return False
        if value.strip().upper() in GENERIC_VALUES:
            return False
        return True
    # For non‑string types, treat non‑zero / non‑empty values as meaningful.
    return bool(value)


@dataclass
class DetectionSignal:
    """Normalised view of a single qualifying detection/alert for scoring."""

    detection_time: datetime
    is_qualifying: bool

    # Fidelity fields
    specificity_level: Optional[str] = None  # "exact" | "narrow" | "broad" | "generic"
    detection_type: Optional[str] = None  # "behavioral" | "hybrid" | "ioc_only"
    uses_process_tree: bool = False
    uses_multi_condition: bool = False
    expected_fp_rate: Optional[str] = None  # "low" | "medium" | "high"
    severity: Optional[str] = None  # "Critical" | "High" | "Medium" | "Low"

    # 5W fields
    user_name: Optional[str] = None
    user_domain: Optional[str] = None
    user_email: Optional[str] = None
    user_id: Optional[str] = None
    user_sid: Optional[str] = None

    host_name: Optional[str] = None
    host_fqdn: Optional[str] = None
    asset_id: Optional[str] = None
    device_id: Optional[str] = None
    asset_criticality: Optional[str] = None
    os_type: Optional[str] = None
    os_version: Optional[str] = None

    process_name: Optional[str] = None
    process_command_line: Optional[str] = None
    parent_process_name: Optional[str] = None
    parent_process_id: Optional[str] = None
    event_type: Optional[str] = None

    event_time: Optional[datetime] = None
    log_time: Optional[datetime] = None

    src_ip: Optional[str] = None
    src_port: Optional[int] = None
    src_geo: Optional[str] = None
    src_hostname: Optional[str] = None
    src_asn: Optional[str] = None

    dest_ip: Optional[str] = None
    dest_domain: Optional[str] = None
    dest_port: Optional[int] = None
    dest_hostname: Optional[str] = None
    dest_geo: Optional[str] = None
    url: Optional[str] = None

    technique_id: Optional[str] = None
    tactic: Optional[str] = None
    framework: Optional[str] = None
    rule_name: Optional[str] = None
    detection_rule_id: Optional[str] = None
    category: Optional[str] = None
    # High-level source / vendor / environment metadata (optional).
    log_source: Optional[str] = None
    vendor: Optional[str] = None
    env_size_bucket: Optional[str] = None  # e.g. "xs", "s", "m", "l", "xl"


def _specificity_score(d: DetectionSignal) -> int:
    mapping = {
        "exact": 100,
        "narrow": 85,
        "broad": 65,
        "generic": 40,
    }
    return mapping.get((d.specificity_level or "").lower(), 60)


def _behavioral_depth_score(d: DetectionSignal) -> int:
    base_map = {
        "behavioral": 80,
        "hybrid": 65,
        "ioc_only": 50,
    }
    base = base_map.get((d.detection_type or "").lower(), 60)
    if d.uses_process_tree:
        base += 10
    if d.uses_multi_condition:
        base += 10
    return max(0, min(100, base))


def _signal_to_noise_score(d: DetectionSignal) -> int:
    mapping = {
        "low": 100,
        "medium": 75,
        "high": 50,
    }
    return mapping.get((d.expected_fp_rate or "").lower(), 75)


def _severity_alignment_score(d: DetectionSignal) -> int:
    mapping = {
        "critical": 100,
        "high": 85,
        "medium": 70,
        "low": 50,
    }
    return mapping.get((d.severity or "").lower(), 70)


def fidelity_score(d: DetectionSignal) -> float:
    """Combine specificity, behavioral depth, noise expectations and severity."""
    f_spec = _specificity_score(d)
    f_beh = _behavioral_depth_score(d)
    f_noise = _signal_to_noise_score(d)
    f_sev = _severity_alignment_score(d)

    return 0.4 * f_spec + 0.3 * f_beh + 0.2 * f_noise + 0.1 * f_sev


def _who_score(d: DetectionSignal) -> int:
    # user
    user_good = any(
        _is_meaningful(x)
        for x in (d.user_name, d.user_domain, d.user_email, d.user_id, d.user_sid)
    )

    # host
    host_good = any(
        _is_meaningful(x)
        for x in (
            d.host_name,
            d.host_fqdn,
            d.asset_id,
            d.device_id,
            d.asset_criticality,
            d.os_type,
            d.os_version,
        )
    )

    if user_good and host_good:
        return 20
    if user_good or host_good:
        return 10
    return 0


def _what_score(d: DetectionSignal) -> int:
    base = 0
    if _is_meaningful(d.process_name) and _is_meaningful(d.process_command_line):
        base = 15

    has_tree = _is_meaningful(d.parent_process_name) or _is_meaningful(
        d.parent_process_id
    )

    if base == 15 and (has_tree or _is_meaningful(d.event_type)):
        return 20
    if base == 15:
        return 15
    if _is_meaningful(d.event_type):
        return 10
    return 0


def _when_score(d: DetectionSignal, detection_time: datetime) -> int:
    event_time = d.event_time or d.log_time
    if not event_time:
        return 0

    iso_str = event_time.isoformat()
    high_res = False
    if "T" in iso_str:
        time_part = iso_str.split("T", 1)[1]
        if ":" in time_part:
            high_res = True

    has_det = detection_time is not None

    if high_res and has_det:
        return 20
    if high_res:
        return 15
    return 10


def _where_score(d: DetectionSignal) -> int:
    src_ok = False
    if _is_meaningful(d.src_ip) and d.src_ip not in ["0.0.0.0", "::"]:  # nosec B104 -- excluding a telemetry value, not binding a socket
        extras = [d.src_port, d.src_geo, d.src_hostname, d.src_asn]
        src_ok = any(_is_meaningful(x) for x in extras)

    dest_ok = False
    if _is_meaningful(d.dest_ip) or _is_meaningful(d.dest_domain):
        extras = [d.dest_port, d.dest_hostname, d.dest_geo, d.url]
        dest_ok = any(_is_meaningful(x) for x in extras)

    if src_ok and dest_ok:
        return 20
    if src_ok or dest_ok:
        return 10
    return 0


def _why_score(d: DetectionSignal) -> int:
    tech_ok = _is_meaningful(d.technique_id)
    mapping_ok = any(
        _is_meaningful(x)
        for x in (d.tactic, d.framework, d.rule_name, d.detection_rule_id, d.category)
    )
    sev_ok = _is_meaningful(d.severity)

    if tech_ok and mapping_ok and sev_ok:
        return 20
    if tech_ok and (mapping_ok or sev_ok):
        return 15
    if mapping_ok or tech_ok:
        return 10
    return 0


def _hash_category(value: Optional[str]) -> float:
    """
    Deterministically hash a categorical string into [0, 1] for simple models.

    This avoids leaking raw identifiers into the model input while still giving
    it a stable signal it can learn from.
    """
    if not value:
        return 0.0
    try:
        # Use a stable checksum instead of Python's builtin hash (which is
        # deliberately randomised between processes).
        checksum = zlib.adler32(value.encode("utf-8")) & 0xFFFFFFFF
        return (checksum % 10_000) / 10_000.0
    except Exception:
        return 0.0


def prepare_features_for_model(features: Dict[str, Any]) -> List[float]:
    """
    Very small helper to turn a flat feature dict into a model‑ready vector.

    This keeps feature ordering explicit and avoids accidental drift if we
    add extra keys in the future. It also encodes a few categorical attributes
    into stable numeric hashes so simple sklearn-style models can consume them.
    """
    ordered_numeric_keys = ["C", "T", "F", "E", "base_score"]
    vector: List[float] = []

    for key in ordered_numeric_keys:
        if key in features and features[key] is not None:
            vector.append(float(features[key]))
        else:
            vector.append(0.0)

    # Categorical / metadata features (all optional).
    vector.append(_hash_category(str(features.get("technique_id") or "")))
    vector.append(_hash_category(str(features.get("tactic") or "")))
    vector.append(_hash_category(str(features.get("log_source") or "")))
    vector.append(_hash_category(str(features.get("vendor") or "")))
    vector.append(_hash_category(str(features.get("env_size_bucket") or "")))

    return vector


def score_test_run(
    attack_start_time: datetime,
    detections_raw: List[Dict[str, Any]],
    ml_model: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Compute C/T/F/E + 5W enrichment scores for a single test run.

    This function is intentionally pure and side‑effect‑free so it can be
    called from FastAPI routes, background jobs, or external services.
    """
    # Normalise detections into DetectionSignal objects, dropping unknown keys.
    field_names = set(DetectionSignal.__annotations__.keys())
    detections: List[DetectionSignal] = []
    for raw in detections_raw:
        if not isinstance(raw, dict):
            continue
        filtered = {k: v for k, v in raw.items() if k in field_names}
        try:
            detections.append(DetectionSignal(**filtered))
        except TypeError:
            # Skip malformed entries defensively; scoring is best‑effort.
            continue

    qualifying = [d for d in detections if d.is_qualifying]

    # Coverage
    if not qualifying:
        return {
            "coverage": 0,
            "timeliness": 0,
            "fidelity": 0,
            "enrichment": 0,
            "enrichment_breakdown": {
                "who": 0,
                "what": 0,
                "when": 0,
                "where": 0,
                "why": 0,
            },
            "base_score": 0.0,
            "ml_adjustment": 0.0,
            "final_score": 0.0,
            "delay_seconds": None,
        }

    # Pick earliest qualifying detection as the representative signal.
    chosen = min(qualifying, key=lambda d: d.detection_time)
    
    # Validate detection_time is a datetime before computing delay.
    if not isinstance(chosen.detection_time, datetime):
        logger.warning(
            "Invalid detection_time type in scoring, using attack_start_time",
            extra={"detection_time_type": type(chosen.detection_time).__name__},
        )
        delay_seconds = 0.0
    else:
        try:
            delay_seconds = (chosen.detection_time - attack_start_time).total_seconds()
            # Clamp delay to reasonable bounds to prevent negative or extreme values.
            delay_seconds = max(0.0, min(delay_seconds, 86400.0))  # 0 to 24 hours
        except (TypeError, OverflowError, ValueError) as e:
            logger.warning(
                "Error computing delay_seconds, defaulting to 0",
                extra={"error": str(e)},
            )
            delay_seconds = 0.0

    # Timeliness (T) – simple piecewise mapping with validated numeric delay.
    try:
        delay_float = float(delay_seconds)
    except (TypeError, ValueError):
        logger.warning(
            "Invalid delay_seconds value in timeliness calculation, defaulting to 0",
            extra={"delay_seconds": delay_seconds},
        )
        delay_float = 0.0
    
    if delay_float <= 30:
        t_score = 100
    elif delay_float <= 120:
        t_score = 85
    elif delay_float <= 300:
        t_score = 70
    elif delay_float <= 900:
        t_score = 40
    elif delay_float <= 3600:
        t_score = 20
    else:
        t_score = 0

    coverage = 100  # We already know at least one qualifying detection exists.
    fidelity = fidelity_score(chosen)

    # Enrichment (5Ws)
    who = _who_score(chosen)
    what = _what_score(chosen)
    when = _when_score(chosen, chosen.detection_time)
    where = _where_score(chosen)
    why = _why_score(chosen)

    enrichment = who + what + when + where + why

    # Weighted base score
    w_c, w_t, w_f, w_e = 0.35, 0.25, 0.25, 0.15
    base_score = w_c * coverage + w_t * t_score + w_f * fidelity + w_e * enrichment

    # Optional ML nudge
    ml_adjustment = 0.0
    final_score = base_score

    if ml_model is not None:
        features = {
            "C": coverage,
            "T": t_score,
            "F": fidelity,
            "E": enrichment,
            "base_score": base_score,
            "technique_id": chosen.technique_id,
            "tactic": chosen.tactic,
            "log_source": chosen.category,  # can be refined to a dedicated field later
            "vendor": chosen.framework,
            "env_size_bucket": None,
        }
        try:
            X = prepare_features_for_model(features)
            # Validate model has predict_proba method before calling.
            if not hasattr(ml_model, "predict_proba"):
                raise ValueError("ML model does not support predict_proba")
            
            proba_result = ml_model.predict_proba([X])
            if not proba_result or len(proba_result) == 0 or len(proba_result[0]) < 2:
                raise ValueError("ML model returned invalid probability array")
            
            proba = proba_result[0][1]
            p_good = float(proba)
            
            # Validate probability is in valid range [0, 1]
            if not (0.0 <= p_good <= 1.0):
                raise ValueError(f"ML model returned invalid probability: {p_good}")
            
            ml_adjustment = (p_good - 0.5) * 20.0  # ~ -10..+10

            proposed = max(0.0, min(100.0, base_score + ml_adjustment))
            # Clamp ML‑adjusted score to a small band around base_score.
            final_score = max(base_score - 10.0, min(base_score + 10.0, proposed))
        except (ValueError, AttributeError, IndexError, TypeError) as ml_err:
            # Log specific ML errors for debugging but don't break scoring.
            logger.warning(
                "ML model adjustment failed, using deterministic score",
                extra={"error": str(ml_err), "base_score": base_score},
            )
            ml_adjustment = 0.0
            final_score = base_score
        except Exception as ml_err:
            # Catch-all for any other ML errors (network, serialization, etc.)
            logger.warning(
                "Unexpected ML model error, using deterministic score",
                extra={"error": str(ml_err), "base_score": base_score},
            )
            ml_adjustment = 0.0
            final_score = base_score

    # Validate all numeric outputs are finite before returning.
    def safe_round(value: float, decimals: int = 2) -> float:
        """Round a value safely, handling NaN and Inf."""
        try:
            if not isinstance(value, (int, float)):
                return 0.0
            if not (float("-inf") < value < float("inf")):
                return 0.0
            return round(float(value), decimals)
        except (TypeError, ValueError, OverflowError):
            return 0.0
    
    return {
        "coverage": int(coverage) if 0 <= coverage <= 100 else 0,
        "timeliness": int(t_score) if 0 <= t_score <= 100 else 0,
        "fidelity": safe_round(fidelity, 2),
        "enrichment": int(enrichment) if 0 <= enrichment <= 100 else 0,
        "enrichment_breakdown": {
            "who": int(who) if 0 <= who <= 20 else 0,
            "what": int(what) if 0 <= what <= 20 else 0,
            "when": int(when) if 0 <= when <= 20 else 0,
            "where": int(where) if 0 <= where <= 20 else 0,
            "why": int(why) if 0 <= why <= 20 else 0,
        },
        "base_score": safe_round(base_score, 2),
        "ml_adjustment": safe_round(ml_adjustment, 2),
        "final_score": safe_round(final_score, 2),
        "delay_seconds": safe_round(delay_float if "delay_float" in locals() else delay_seconds, 2),
    }
