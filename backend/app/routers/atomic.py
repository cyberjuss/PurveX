from typing import List, Optional, Dict, Any

import logging
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException

from ..schemas import AtomicTestDefinition, AtomicArgSpec


logger = logging.getLogger("purvex.atomic")
router = APIRouter(prefix="/atomic", tags=["atomic"])


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
            "Atomic Red Team repo not found at %s – Atomic catalog unavailable.",
            atomic_root,
        )
        return []

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
        logger.warning("No Atomic tests were loaded from %s.", atomic_root)
        return []

    logger.info("Loaded %d Atomic Red Team tests from %s", len(tests), atomic_root)
    return tests


# Load atomic tests at module import time.
try:
    ATOMIC_TESTS: List[AtomicTestDefinition] = _load_atomic_tests()
except Exception as e:
    logger.error(
        "Failed to load Atomic Red Team tests: %s.",
        e,
        exc_info=True,
    )
    ATOMIC_TESTS: List[AtomicTestDefinition] = []


def _ensure_atomic_catalog_loaded() -> None:
    if ATOMIC_TESTS:
        return
    raise HTTPException(
        status_code=503,
        detail=(
            "Atomic Red Team catalog not installed. Clone the official repo to "
            "backend/data/atomic-red-team and try again."
        ),
    )

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

    Backed by a local clone of the Atomic Red Team repo.
    """
    _ensure_atomic_catalog_loaded()
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
    _ensure_atomic_catalog_loaded()
    for t in ATOMIC_TESTS:
        if t.id == atomic_id:
            return t
    raise HTTPException(status_code=404, detail="Atomic test not found")

