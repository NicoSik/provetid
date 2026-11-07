"""The owner's saved limits, one file per plan: `<data_dir>/limits/<plan_id>.json`."""

import os
import tempfile
from pathlib import Path

from provetid.gateway.limits import Limits
from provetid.plan.store import is_safe_id

DEMO_PLAN_ID = "demo"


def load_limits(data_dir: Path, plan_id: str) -> Limits | None:
    """The saved limits of this plan, or `None` if there are none or the file is broken."""
    if not is_safe_id(plan_id):
        return None
    path = data_dir / "limits" / f"{plan_id}.json"
    if plan_id == DEMO_PLAN_ID and not path.exists():
        # Before the limits were per plan, one `limits.json` held them. They belong to the demo.
        path = data_dir / "limits.json"
    try:
        return Limits.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def save_limits(limits: Limits, data_dir: Path, plan_id: str) -> None:
    """Write through a temporary file, so a failed save keeps the old values."""
    if not is_safe_id(plan_id):
        raise ValueError(f"unsafe plan id: {plan_id!r}")
    folder = data_dir / "limits"
    folder.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=folder, prefix="limits-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as f:
            f.write(limits.model_dump_json(indent=2) + "\n")
        os.replace(temporary, folder / f"{plan_id}.json")
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
