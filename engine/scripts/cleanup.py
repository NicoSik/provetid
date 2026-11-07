"""Get the repository ready to hand in (D54).

`cleanup.py` empties the run logs and the submitted scams, then scans the files that would be
handed in for tokens. It prints `file:line` for each hit and exits with 1 if there is one.
`cleanup.py --package` does the same, then writes provetid-submission.zip from the tracked
files, the built UI and the pinned replays. It writes no zip when the scan finds a token.

It empties the default data folders under engine/data. If PROVETID_DATA_DIR points elsewhere,
that folder is left alone; it is never part of the zip either way.
"""

import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ZIP_NAME = "provetid-submission.zip"
DATA_DIRS = ("engine/data/runs", "engine/data/scams/submitted")
EXTRA_DIRS = ("ui/dist", "ui/public/replays")  # handed in even when not tracked
SKIP_PARTS = {".git", "node_modules", ".venv"}

# Each pattern needs a realistic body after its prefix, so a bare prefix in docs is no hit.
TOKEN = re.compile(
    r"sk-ant-[A-Za-z0-9_-]{20,}"
    r"|\bgh[pousr]_[A-Za-z0-9]{36,}"
    r"|\bgithub_pat_[A-Za-z0-9_]{22,}"
    r"|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"
    r"|-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----"
)


class CleanupError(Exception):
    pass


def clean(root: Path) -> None:
    """Empty the run logs and the submitted scams. The pinned replays live elsewhere and stay.

    A data folder that is a symlink is left alone, so this never deletes outside the checkout.
    """
    for rel in DATA_DIRS:
        folder = root / rel
        if folder.is_symlink() or not folder.is_dir():
            continue
        for item in folder.iterdir():
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()


def _tracked(root: Path) -> set[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        raise CleanupError(f"Cannot list the tracked files with git in {root}: {e}") from e
    return {os.fsdecode(name) for name in out.split(b"\0") if name}


def handed_in(root: Path) -> list[str]:
    """The files that go into the zip, as sorted paths relative to `root`. Symlinks are left
    out, so nothing from outside the checkout can end up in the zip."""
    files = _tracked(root)
    for rel in EXTRA_DIRS:
        folder = root / rel
        if folder.is_dir() and not folder.is_symlink():
            files.update(p.relative_to(root).as_posix() for p in folder.rglob("*"))
    return sorted(
        f
        for f in files
        if (root / f).is_file()
        and not (root / f).is_symlink()
        and not SKIP_PARTS & set(Path(f).parts)
        and Path(f).name != ".env"
        and f != ZIP_NAME
    )


def scan(root: Path) -> list[str]:
    """Return `file:line` for every token in the files that would be handed in.

    A hit in a binary file is `file:binary`, since its line numbers mean nothing.
    """
    hits: list[str] = []
    for rel in handed_in(root):
        raw = (root / rel).read_bytes()
        text = raw.decode("utf-8", errors="replace")
        if b"\0" in raw:  # a binary file (font, image): line numbers would mean nothing
            if TOKEN.search(text):
                hits.append(f"{rel}:binary")
            continue
        for number, line in enumerate(text.split("\n"), start=1):
            if TOKEN.search(line):
                hits.append(f"{rel}:{number}")
    return hits


def package(root: Path) -> Path:
    target = root / ZIP_NAME
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in handed_in(root):
            zf.write(root / rel, rel)
    return target


def main(argv: list[str], root: Path = ROOT) -> int:
    if argv not in ([], ["--package"]):
        print("Usage: cleanup.py [--package]", file=sys.stderr)
        return 2
    try:
        _tracked(root)  # check git before anything is deleted
    except CleanupError as e:
        print(e, file=sys.stderr)
        return 2
    clean(root)
    print(f"Emptied {', '.join(DATA_DIRS)}.")
    hits = scan(root)
    for hit in hits:
        print(hit)
    if hits:
        print(
            f"Found {len(hits)} possible token(s). Remove them before you hand in.", file=sys.stderr
        )
        return 1
    print("No tokens found.")
    if argv == ["--package"]:
        print(f"Wrote {package(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
