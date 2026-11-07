"""Run one normal chat and one attacker chat live. Prints PASS when both look right.

Run it with `make live-smoke`. It needs the fake customers of `data/customers/`.
"""

import asyncio
import sys
import uuid

from _live import load_customers

from provetid.config import load_settings
from provetid.eventlog import EventLog
from provetid.gateway.limits import limits_from_rules
from provetid.plan.models import TestPlan
from provetid.runner.run import run_plan
from provetid.runner.steps import default_steps
from provetid.transport.claude_cli import ClaudeCliTransport

REQUIRED = {"chat_started", "chat_ended"}


async def main() -> int:
    settings = load_settings()
    customers = [load_customers(settings, "normal")[0], load_customers(settings, "attackers")[0]]
    plan = TestPlan(id="smoke", job_ad="", rules=[], customers=customers)
    run_id = f"smoke-{uuid.uuid4().hex[:6]}"
    log = EventLog(run_id, settings.data_dir / "runs" / f"{run_id}.jsonl")
    transport = ClaudeCliTransport(settings)
    await run_plan(
        plan,
        "observe",
        limits_from_rules(plan.rules),
        transport,
        settings,
        log,
        default_steps(transport),
    )
    ok = True
    for chat_id in sorted({e.chat_id for e in log.read() if e.chat_id}):
        events = [e for e in log.read() if e.chat_id == chat_id]
        types = {e.type for e in events}
        roles = {e.data["role"] for e in events if e.type == "message"}
        chat_ok = types >= REQUIRED and roles == {"customer", "bot"}
        print(f"{chat_id}: {'ok' if chat_ok else 'MISSING'} {sorted(types)} {sorted(roles)}")
        ok = ok and chat_ok
    ok = ok and len({e.chat_id for e in log.read() if e.chat_id}) == 2
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
