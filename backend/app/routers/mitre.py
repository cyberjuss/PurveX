from typing import List, Optional, Dict, Any

import json
import logging
from pathlib import Path

from fastapi import APIRouter

from ..schemas import MitreTechnique


logger = logging.getLogger("purvex.mitre")
router = APIRouter(prefix="/mitre", tags=["mitre"])


def _load_mitre_catalog() -> List[MitreTechnique]:
    """
    Load the full MITRE ATT&CK Enterprise catalog from enterprise-attack.json.

    The file is expected at backend/data/enterprise-attack.json relative to the
    backend package root. If the file is missing or cannot be parsed, we fall
    back to a very small built-in sample so the UI still works.
    """

    # Detect the backend root and data path dynamically so this works in dev and prod.
    backend_root = Path(__file__).resolve().parents[2]  # .../backend
    attack_path = backend_root / "data" / "enterprise-attack.json"

    if not attack_path.exists():
        logger.warning(
            "MITRE ATT&CK JSON not found at %s – using small built-in sample catalog.",
            attack_path,
        )
        # Richer sample so the UI shows multiple tactics and sub-techniques
        # even when the full ATT&CK JSON is not present.
        return [
            # Reconnaissance
            MitreTechnique(
                id="T1595",
                name="Active Scanning",
                tactics=["Reconnaissance"],
            ),
            MitreTechnique(
                id="T1595.001",
                name="Active Scanning: Scanning IP Blocks",
                tactics=["Reconnaissance"],
                is_subtechnique=True,
            ),
            # Resource Development
            MitreTechnique(
                id="T1583",
                name="Acquire Infrastructure",
                tactics=["Resource Development"],
            ),
            MitreTechnique(
                id="T1583.001",
                name="Acquire Infrastructure: Domains",
                tactics=["Resource Development"],
                is_subtechnique=True,
            ),
            # Initial Access
            MitreTechnique(
                id="T1566",
                name="Phishing",
                tactics=["Initial Access"],
            ),
            MitreTechnique(
                id="T1566.001",
                name="Spearphishing Attachment",
                tactics=["Initial Access"],
                is_subtechnique=True,
            ),
            # Execution
            MitreTechnique(
                id="T1059",
                name="Command and Scripting Interpreter",
                tactics=["Execution"],
            ),
            MitreTechnique(
                id="T1059.001",
                name="PowerShell",
                tactics=["Execution"],
                is_subtechnique=True,
            ),
            MitreTechnique(
                id="T1047",
                name="Windows Management Instrumentation",
                tactics=["Execution"],
            ),
        ]

    try:
        with attack_path.open("r", encoding="utf-8") as f:
            data: Dict[str, Any] = json.load(f)
    except Exception:
        logger.exception(
            "Failed to load MITRE ATT&CK catalog from %s – falling back to sample.",
            attack_path,
        )
        # Use the same richer sample as above on parse errors.
        return [
            MitreTechnique(
                id="T1595",
                name="Active Scanning",
                tactics=["Reconnaissance"],
            ),
            MitreTechnique(
                id="T1595.001",
                name="Active Scanning: Scanning IP Blocks",
                tactics=["Reconnaissance"],
                is_subtechnique=True,
            ),
            MitreTechnique(
                id="T1583",
                name="Acquire Infrastructure",
                tactics=["Resource Development"],
            ),
            MitreTechnique(
                id="T1583.001",
                name="Acquire Infrastructure: Domains",
                tactics=["Resource Development"],
                is_subtechnique=True,
            ),
            MitreTechnique(
                id="T1566",
                name="Phishing",
                tactics=["Initial Access"],
            ),
            MitreTechnique(
                id="T1566.001",
                name="Spearphishing Attachment",
                tactics=["Initial Access"],
                is_subtechnique=True,
            ),
            MitreTechnique(
                id="T1059",
                name="Command and Scripting Interpreter",
                tactics=["Execution"],
            ),
            MitreTechnique(
                id="T1059.001",
                name="PowerShell",
                tactics=["Execution"],
                is_subtechnique=True,
            ),
            MitreTechnique(
                id="T1047",
                name="Windows Management Instrumentation",
                tactics=["Execution"],
            ),
        ]

    objects: List[Dict[str, Any]] = data.get("objects", [])

    # Map tactic shortnames (e.g. "execution") to friendly names ("Execution")
    tactic_short_to_name: Dict[str, str] = {}
    for obj in objects:
        if obj.get("type") == "x-mitre-tactic":
            shortname = obj.get("x_mitre_shortname") or obj.get("x-mitre-shortname")
            name = obj.get("name")
            if shortname and name:
                tactic_short_to_name[shortname] = name

    techniques: List[MitreTechnique] = []

    for obj in objects:
        if obj.get("type") != "attack-pattern":
            continue

        # Skip deprecated / revoked.
        if obj.get("revoked") or obj.get("x_mitre_deprecated") or obj.get(
            "x-mitre-deprecated"
        ):
            continue

        external_id: Optional[str] = None
        for ref in obj.get("external_references", []):
            if ref.get("source_name") in {
                "mitre-attack",
                "mitre-enterprise",
                "mitre-ics-attack",
                "mitre-mobile-attack",
            }:
                external_id = ref.get("external_id")
                break

        if not external_id or not external_id.startswith("T"):
            continue

        # Only include techniques in the Enterprise (mitre-attack) kill-chain.
        kill_chain_phases = obj.get("kill_chain_phases", [])
        phase_shortnames = [
            phase.get("phase_name")
            for phase in kill_chain_phases
            if phase.get("kill_chain_name") == "mitre-attack"
        ]

        if not phase_shortnames:
            continue

        tactic_names: List[str] = [
            tactic_short_to_name.get(short, (short or "").title())
            for short in phase_shortnames
            if short
        ]

        if not tactic_names:
            continue

        is_sub = bool(
            obj.get("x_mitre_is_subtechnique")
            or obj.get("x-mitre-is-subtechnique")
        )

        techniques.append(
            MitreTechnique(
                id=external_id,
                name=obj.get("name") or external_id,
                tactics=tactic_names,
                is_subtechnique=is_sub,
            )
        )

    techniques.sort(key=lambda t: t.id)
    logger.info(
        "Loaded %d MITRE ATT&CK techniques from %s", len(techniques), attack_path
    )
    return techniques


MITRE_TECHNIQUES: List[MitreTechnique] = _load_mitre_catalog()


@router.get("/techniques", response_model=List[MitreTechnique])
async def list_mitre_techniques(tactic: Optional[str] = None) -> List[MitreTechnique]:
    """
    Return the ATT&CK Enterprise techniques used by the Tests tab.

    - `tactic` can be used to filter by high-level tactic name, e.g. "Execution".
    """
    if tactic:
        tactic_lower = tactic.lower()
        return [
            t
            for t in MITRE_TECHNIQUES
            if any(tactic_lower == tac.lower() for tac in t.tactics)
        ]
    return MITRE_TECHNIQUES

