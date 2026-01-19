from typing import List, Optional, Dict, Any

import logging
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException

from ..schemas import AtomicTestDefinition, AtomicArgSpec


logger = logging.getLogger("purvex.atomic")
router = APIRouter(prefix="/atomic", tags=["atomic"])


# Small built-in sample set used when a full Atomic Red Team checkout
# isn't available on disk.
SAMPLE_ATOMIC_TESTS: List[AtomicTestDefinition] = [
    AtomicTestDefinition(
        id="T1059.001-1",
        technique_id="T1059.001",
        name="Suspicious PowerShell execution",
        description="Runs a base64-encoded PowerShell payload tagged with a PurveX marker.",
        platforms=["windows"],
        is_safe=True,
        args=[
            AtomicArgSpec(
                name="command",
                label="PowerShell command",
                type="string",
                required=False,
                default='powershell.exe -NoProfile -EncodedCommand <base64>',
                description="Override to match your lab environment.",
            )
        ],
    ),
    AtomicTestDefinition(
        id="T1047-1",
        technique_id="T1047",
        name="WMI process execution",
        description="Executes a simple process via WMI to exercise process creation logging.",
        platforms=["windows"],
        is_safe=True,
        args=[],
    ),
    AtomicTestDefinition(
        id="T1566.001-1",
        technique_id="T1566.001",
        name="Phishing link delivered via email",
        description="Simulates delivery of a phishing link to exercise email and proxy detections.",
        platforms=["windows", "cloud"],
        is_safe=True,
        args=[],
    ),
]


def _load_atomic_tests() -> List[AtomicTestDefinition]:
    """
    Load Atomic Red Team tests from a local checkout of the official repo.

    Expected layout (based on the upstream project structure [redcanaryco/atomic-red-team](https://github.com/redcanaryco/atomic-red-team)):

    - backend/data/atomic-red-team/
      - atomics/
        - T1059/
          - T1059.yaml
        - T1047/
          - T1047.yaml
        - ...

    Each YAML file contains an ``attack_technique`` id and an ``atomic_tests``
    list. We project a minimal subset of that schema into our
    ``AtomicTestDefinition`` model so the Explore page can show the full
    catalog.
    """

    backend_root = Path(__file__).resolve().parents[2]
    atomic_root = backend_root / "data" / "atomic-red-team" / "atomics"

    if not atomic_root.exists():
        logger.warning(
            "Atomic Red Team repo not found at %s – using built-in sample catalog.",
            atomic_root,
        )
        return SAMPLE_ATOMIC_TESTS

    tests: List[AtomicTestDefinition] = []

    for technique_dir in sorted(atomic_root.iterdir()):
        if not technique_dir.is_dir():
            continue
        # Directory names are technique ids like T1059, T1047, etc.
        default_technique_id = technique_dir.name

        for yaml_path in list(technique_dir.glob("*.yml")) + list(
            technique_dir.glob("*.yaml")
        ):
            try:
                with yaml_path.open("r", encoding="utf-8") as f:
                    doc: Dict[str, Any] = yaml.safe_load(f) or {}
            except (yaml.YAMLError, UnicodeDecodeError, OSError, Exception) as e:
                logger.warning(
                    "Failed to parse Atomic YAML %s: %s. Skipping file.",
                    yaml_path,
                    e,
                )
                continue

            technique_id = (
                doc.get("attack_technique") or default_technique_id
            ).strip()
            atomic_tests = doc.get("atomic_tests") or []

            for idx, test in enumerate(atomic_tests, start=1):
                name = test.get("name") or f"{technique_id} atomic {idx}"
                description = test.get("description") or ""
                platforms = test.get("supported_platforms") or []

                # Map input_arguments into a simple arg spec list.
                arg_specs: List[AtomicArgSpec] = []
                input_args: Dict[str, Any] = test.get("input_arguments") or {}
                for arg_name, arg in input_args.items():
                    arg_specs.append(
                        AtomicArgSpec(
                            name=arg_name,
                            label=arg.get("display_name") or arg_name,
                            type="string",
                            required=not bool(arg.get("default")),
                            default=str(arg.get("default"))
                            if arg.get("default") is not None
                            else None,
                            description=arg.get("description"),
                        )
                    )

                test_id = (
                    test.get("auto_generated_guid")
                    or f"{technique_id}-{yaml_path.stem}-{idx}"
                )

                tests.append(
                    AtomicTestDefinition(
                        id=test_id,
                        technique_id=technique_id,
                        name=name,
                        description=description,
                        platforms=platforms,
                        # Upstream doesn't encode "safety" in a simple way; default to True
                        # and let the operator decide which tests to run in their lab.
                        is_safe=True,
                        args=arg_specs,
                    )
                )

    if not tests:
        logger.warning(
            "No Atomic tests were loaded from %s – falling back to sample catalog.",
            atomic_root,
        )
        return SAMPLE_ATOMIC_TESTS

    logger.info("Loaded %d Atomic Red Team tests from %s", len(tests), atomic_root)
    return tests


# Load atomic tests at module import time, but gracefully fall back to samples on error
try:
    ATOMIC_TESTS: List[AtomicTestDefinition] = _load_atomic_tests()
except Exception as e:
    logger.error(
        "Failed to load Atomic Red Team tests: %s. Falling back to sample catalog.",
        e,
        exc_info=True,
    )
    ATOMIC_TESTS: List[AtomicTestDefinition] = SAMPLE_ATOMIC_TESTS



@router.get("/tests", response_model=dict)
async def list_atomic_tests(
    technique_id: Optional[str] = None,
    q: Optional[str] = None,
    platform: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """
    Lightweight Atomic catalog.

    In a real deployment this would be backed by a local clone of the
    Atomic Red Team repo or a customer-provided catalog. For the MVP we
    return a small, hard-coded sample set so the UI can be exercised.
    """
    items = ATOMIC_TESTS

    if technique_id:
        base = technique_id.lower()
        items = [
            t
            for t in items
            if t.technique_id.lower() == base or t.technique_id.lower().startswith(f"{base}.")
        ]

    if q:
        q_lower = q.lower()
        items = [
            t
            for t in items
            if q_lower in t.name.lower()
            or (t.description or "").lower().find(q_lower) != -1
            or t.technique_id.lower().find(q_lower) != -1
        ]

    if platform:
        p_lower = platform.lower()
        items = [t for t in items if any(p_lower == p.lower() for p in t.platforms)]

    total = len(items)
    sliced = items[offset : offset + limit]

    # Match the frontend expectation: { items, total }
    return {"items": sliced, "total": total}


@router.get("/tests/{atomic_id}", response_model=AtomicTestDefinition)
async def get_atomic_test(atomic_id: str):
    for t in ATOMIC_TESTS:
        if t.id == atomic_id:
            return t
    raise HTTPException(status_code=404, detail="Atomic test not found")


