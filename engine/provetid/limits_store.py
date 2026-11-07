"""The owner's saved limits: `<data_dir>/limits.json`."""

import os
import tempfile
from pathlib import Path

from provetid.gateway.limits import Limits


def load_limits(data_dir: Path) -> Limits | None:
    """The saved limits, or `None` if there are none or the file is broken."""
    try:
        return Limits.model_validate_json((data_dir / "limits.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def save_limits(limits: Limits, data_dir: Path) -> None:
    """Write through a temporary file, so a failed save keeps the old values."""
    data_dir.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=data_dir, prefix="limits-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as f:
            f.write(limits.model_dump_json(indent=2) + "\n")
        os.replace(temporary, data_dir / "limits.json")
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
