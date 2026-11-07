"""Pin a finished run as a replay: copy its log to ui/public/replays/<name>.jsonl.

When the UI is built (ui/dist exists), the pin also goes to ui/dist/replays, because `make demo`
serves the built files. Each copy goes to a temporary file first and then replaces the target in
one step, so a failed pin never leaves a broken replay behind.
"""

import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from provetid.config import load_settings
from provetid.eventlog import EventLog

NAMES = ("before", "after", "scam")
REPLAYS_DIR = Path(__file__).resolve().parents[2] / "ui" / "public" / "replays"
DIST_DIR = Path(__file__).resolve().parents[2] / "ui" / "dist"
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


class PinError(Exception):
    pass


def pin(run_id: str, name: str, runs_dir: Path, replays_dir: Path) -> Path:
    if name not in NAMES:
        raise PinError(f"The name must be one of {', '.join(NAMES)}, not {name!r}.")
    source = runs_dir / f"{run_id}.jsonl"
    if not _SAFE_ID.match(run_id) or not source.is_file():
        raise PinError(f"Found no run {run_id!r} in {runs_dir}.")
    try:
        events = EventLog(run_id, source).read()
    except ValueError as e:
        raise PinError(f"Run {run_id!r} has a broken log, so it cannot be pinned: {e}") from e
    # A pinned replay is what the audience sees, so only a complete run can replace a good one.
    if not events or events[-1].type != "run_finished":
        raise PinError(f"Run {run_id!r} has no run_finished, so it cannot be pinned.")
    if events[-1].data.get("incomplete"):
        raise PinError(f"Run {run_id!r} stopped early, so it cannot be pinned.")
    return _copy_atomically(source, replays_dir / f"{name}.jsonl")


def _copy_atomically(source: Path, target: Path) -> Path:
    """Copy to a temporary file in the target's folder, then replace the target in one step.

    The temporary file is removed on any failure, also on Ctrl-C, so it never reaches git or the
    submission zip.
    """
    temp: Path | None = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
        os.close(fd)
        temp = Path(temp_name)
        shutil.copyfile(source, temp)
        os.chmod(temp, 0o644)  # mkstemp makes 0600; the served replay must be readable
        os.replace(temp, target)
        temp = None
    except OSError as e:
        raise PinError(f"Could not write {target}: {e}") from e
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)
    return target


@dataclass
class PinResult:
    public: Path  # the pin in ui/public/replays
    dist: Path | None = None  # the copy in the built UI, if there is one
    dist_error: str | None = None  # why the built UI could not be updated


def pin_all(run_id: str, name: str, runs_dir: Path, replays_dir: Path, dist_dir: Path) -> PinResult:
    """Pin to the public replays, and to the built UI too when there is one.

    A failed copy to the built UI does not undo the public pin: the result says what happened.
    """
    result = PinResult(public=pin(run_id, name, runs_dir, replays_dir))
    if dist_dir.is_dir():
        try:
            result.dist = _copy_atomically(result.public, dist_dir / "replays" / result.public.name)
        except PinError as e:
            result.dist_error = str(e)
    return result


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: pin_run.py <run_id> <before|after|scam>", file=sys.stderr)
        return 2
    try:
        result = pin_all(argv[0], argv[1], load_settings().data_dir / "runs", REPLAYS_DIR, DIST_DIR)
    except PinError as e:
        print(e, file=sys.stderr)
        return 1
    print(f"Pinned {argv[0]} as {result.public}")
    if result.dist is not None:
        print(f"Also updated the built UI: {result.dist}")
    elif result.dist_error is not None:
        print(
            f"Warning: the built UI still has the old replay ({result.dist_error}). "
            "Run `make demo` to rebuild it."
        )
    else:
        print("No built UI yet; `make demo` builds it with this pin.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
