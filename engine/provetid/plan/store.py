"""Test plans on disk: `<data_dir>/plans/<id>.json`."""

import re
from pathlib import Path

from provetid.config import load_settings
from provetid.plan.models import TestPlan

_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")


def is_safe_id(value: str) -> bool:
    """True for an id that is safe in a file name. `fullmatch`, so "demo\n" is not safe."""
    return _SAFE_ID.fullmatch(value) is not None


class PlanNotFound(Exception):
    pass


def _plans_dir(data_dir: Path | None) -> Path:
    return (data_dir if data_dir is not None else load_settings().data_dir) / "plans"


def load_plan(plan_id: str, *, data_dir: Path | None = None) -> TestPlan:
    path = _plans_dir(data_dir) / f"{plan_id}.json"
    if not is_safe_id(plan_id) or not path.is_file():
        raise PlanNotFound(plan_id)
    return TestPlan.model_validate_json(path.read_text(encoding="utf-8"))


def save_plan(plan: TestPlan, *, data_dir: Path | None = None) -> None:
    if not is_safe_id(plan.id):
        raise ValueError(f"unsafe plan id: {plan.id!r}")
    folder = _plans_dir(data_dir)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{plan.id}.json").write_text(plan.model_dump_json(indent=2) + "\n", encoding="utf-8")


def list_plans(*, data_dir: Path | None = None) -> list[str]:
    folder = _plans_dir(data_dir)
    if not folder.is_dir():
        return []
    return sorted(p.stem for p in folder.glob("*.json"))
