"""Pin a finished run as a replay: copy its log to ui/public/replays/<name>.jsonl."""

import re
import shutil
import sys
from pathlib import Path

from provetid.config import load_settings
from provetid.eventlog import EventLog

NAMES = ("before", "after", "scam")
REPLAYS_DIR = Path(__file__).resolve().parents[2] / "ui" / "public" / "replays"
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
    target = replays_dir / f"{name}.jsonl"
    try:
        replays_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    except OSError as e:
        raise PinError(f"Could not write {target}: {e}") from e
    return target


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: pin_run.py <run_id> <before|after|scam>", file=sys.stderr)
        return 2
    try:
        target = pin(argv[0], argv[1], load_settings().data_dir / "runs", REPLAYS_DIR)
    except PinError as e:
        print(e, file=sys.stderr)
        return 1
    print(f"Pinned {argv[0]} as {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
