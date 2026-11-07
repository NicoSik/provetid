"""Helpers that smoke.py and timing_test.py share."""

import json
from pathlib import Path

from pydantic import BaseModel

from provetid.config import Settings
from provetid.plan.models import FakeCustomer
from provetid.transport.base import CallResult, Role, Transport


class CostMeter:
    """Wraps a transport and sums the cost of every call."""

    def __init__(self, inner: Transport) -> None:
        self.inner = inner
        self.cost_usd = 0.0
        self.calls = 0

    async def call(
        self, role: Role, system_prompt: str, user_input: str, output: type[BaseModel]
    ) -> CallResult:
        result = await self.inner.call(role, system_prompt, user_input, output)
        self.cost_usd += result.cost_usd
        self.calls += 1
        return result


def load_customers(settings: Settings, group: str) -> list[FakeCustomer]:
    """Read `data/customers/<group>.json`: a list of customers, or {"customers": [...]}."""
    path: Path = settings.data_dir / "customers" / f"{group}.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = raw["customers"] if isinstance(raw, dict) else raw
    return [FakeCustomer.model_validate(item) for item in items]
