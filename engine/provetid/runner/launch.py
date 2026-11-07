"""Start a run in the background, the way `POST /api/runs` does, for routes that build a plan."""

import asyncio
import json
import secrets
from datetime import UTC, datetime
from typing import Any

from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import Mode
from provetid.gateway.limits import Limits
from provetid.plan.models import TestPlan
from provetid.runner.run import run_plan
from provetid.runner.steps import default_steps


def new_run_id() -> str:
    return f"{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"


def launch_run(
    state: Any, plan: TestPlan, mode: Mode, limits: Limits, run_id: str | None = None
) -> str:
    """Start `plan` as a live run on the app's transport and return its run ID.

    `state` is the FastAPI `app.state`, with `settings`, `transport_factory`, `live_logs` and
    `tasks`. Pass `run_id` (from `new_run_id`) to know the ID before the run starts.
    """
    settings: Settings = state.settings
    run_id = run_id or new_run_id()
    runs_dir = settings.data_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    (runs_dir / f"{run_id}.meta.json").write_text(
        json.dumps({"plan_id": plan.id, "mode": mode}), encoding="utf-8"
    )
    log = EventLog(run_id, runs_dir / f"{run_id}.jsonl")
    transport = state.transport_factory()
    state.live_logs[run_id] = log

    def finish(_: asyncio.Task[None]) -> None:
        state.tasks.discard(task)
        state.live_logs.pop(run_id, None)

    task = asyncio.create_task(
        run_plan(plan, mode, limits, transport, settings, log, default_steps(transport))
    )
    state.tasks.add(task)
    task.add_done_callback(finish)
    return run_id
