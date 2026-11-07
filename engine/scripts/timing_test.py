"""Run a full plan live and print the wall time and the cost (REQ-2.6).

Runs `data/plans/demo.json` when it exists. Otherwise it runs the 20 fake customers of
`data/customers/` with no rules. Run it with `make live-timing`.
"""

import asyncio
import time
import uuid

from _live import CostMeter, load_customers

from provetid.config import load_settings
from provetid.eventlog import EventLog
from provetid.gateway.limits import limits_from_rules
from provetid.plan.models import TestPlan
from provetid.plan.store import load_plan
from provetid.runner.run import run_plan
from provetid.runner.steps import default_steps
from provetid.transport.claude_cli import ClaudeCliTransport


async def main() -> None:
    settings = load_settings()
    if (settings.data_dir / "plans" / "demo.json").is_file():
        plan = load_plan("demo", data_dir=settings.data_dir)
    else:
        customers = [
            *load_customers(settings, "normal"),
            *load_customers(settings, "attackers"),
        ]
        plan = TestPlan(id="timing", job_ad="", rules=[], customers=customers[:20])
    run_id = f"timing-{uuid.uuid4().hex[:6]}"
    log = EventLog(run_id, settings.data_dir / "runs" / f"{run_id}.jsonl")
    transport = CostMeter(ClaudeCliTransport(settings))
    started = time.monotonic()
    await run_plan(
        plan,
        "observe",
        limits_from_rules(plan.rules),
        transport,
        settings,
        log,
        default_steps(transport),
    )
    wall = time.monotonic() - started
    events = log.read()
    reasons: dict[str, int] = {}
    for event in events:
        if event.type == "chat_ended":
            reasons[event.data["reason"]] = reasons.get(event.data["reason"], 0) + 1
    print(f"run {run_id}: {len(plan.customers)} chats, {transport.calls} model calls")
    print(f"end reasons: {reasons}")
    print(f"wall time: {wall:.1f} s")
    print(f"cost: ${transport.cost_usd:.4f}")


if __name__ == "__main__":
    asyncio.run(main())
