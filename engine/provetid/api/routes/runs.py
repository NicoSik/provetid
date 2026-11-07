"""Start a run, list runs, read a run's events and stream them live (server-sent events)."""

import asyncio
import json
import re
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import Event, Mode
from provetid.gateway.limits import Limits, limits_from_rules
from provetid.plan.store import PlanNotFound, load_plan
from provetid.runner.run import run_plan
from provetid.runner.steps import default_steps

router = APIRouter(prefix="/api/runs")

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


class RunRequest(BaseModel):
    plan_id: str
    mode: Mode
    limits: Limits | None = None
    extra_instructions: list[str] = []


def _runs_dir(settings: Settings) -> Path:
    return settings.data_dir / "runs"


def _find_log(request: Request, run_id: str) -> tuple[EventLog, bool]:
    """Return the log of a run and whether the run is live in this process."""
    live: dict[str, EventLog] = request.app.state.live_logs
    if run_id in live:
        return live[run_id], True
    path = _runs_dir(request.app.state.settings) / f"{run_id}.jsonl"
    if not _SAFE_ID.match(run_id) or not path.is_file():
        raise HTTPException(status_code=404, detail="Fant ikke kjøringen.")
    return EventLog(run_id, path), False


def _meta(settings: Settings, run_id: str) -> dict[str, str]:
    path = _runs_dir(settings) / f"{run_id}.meta.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


@router.post("")
async def start_run(body: RunRequest, request: Request) -> dict[str, str]:
    state = request.app.state
    settings: Settings = state.settings
    try:
        plan = load_plan(body.plan_id, data_dir=settings.data_dir)
    except PlanNotFound:
        raise HTTPException(status_code=404, detail="Fant ikke testplanen.") from None
    limits = body.limits if body.limits is not None else limits_from_rules(plan.rules)
    limits = limits.model_copy(
        update={"extra_instructions": [*limits.extra_instructions, *body.extra_instructions]}
    )
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    run_id = f"{stamp}-{secrets.token_hex(3)}"
    runs_dir = _runs_dir(settings)
    runs_dir.mkdir(parents=True, exist_ok=True)
    (runs_dir / f"{run_id}.meta.json").write_text(
        json.dumps({"plan_id": plan.id, "mode": body.mode}), encoding="utf-8"
    )
    log = EventLog(run_id, runs_dir / f"{run_id}.jsonl")
    transport = state.transport_factory()
    state.live_logs[run_id] = log

    def finish(_: asyncio.Task[None]) -> None:
        state.tasks.discard(task)
        state.live_logs.pop(run_id, None)

    task = asyncio.create_task(
        run_plan(plan, body.mode, limits, transport, settings, log, default_steps(transport))
    )
    state.tasks.add(task)
    task.add_done_callback(finish)
    return {"run_id": run_id}


@router.get("")
async def list_runs(request: Request) -> list[dict[str, str | bool]]:
    settings: Settings = request.app.state.settings
    folder = _runs_dir(settings)
    ids = sorted((p.stem for p in folder.glob("*.jsonl")), reverse=True) if folder.is_dir() else []
    rows: list[dict[str, str | bool]] = []
    for run_id in ids:
        log, _ = _find_log(request, run_id)
        events = log.read()
        meta = _meta(settings, run_id)
        mode = meta.get("mode") or (events[0].data.get("mode", "") if events else "")
        rows.append(
            {
                "run_id": run_id,
                "plan_id": meta.get("plan_id", ""),
                "mode": mode,
                "finished": log.finished,
            }
        )
    return rows


@router.get("/{run_id}")
async def get_run(run_id: str, request: Request) -> list[Event]:
    log, _ = _find_log(request, run_id)
    return log.read()


@router.get("/{run_id}/status")
async def run_status(run_id: str, request: Request) -> dict[str, bool | int]:
    """Whether more events can come. A log that is neither live nor finished was cut off."""
    log, live = _find_log(request, run_id)
    return {"live": live, "finished": log.finished, "last_seq": log.last_seq}


def _after(request: Request, after: int | None) -> int:
    if after is not None:
        return after
    header = request.headers.get("last-event-id", "")
    return int(header) if header.strip().isdigit() else 0


@router.get("/{run_id}/events")
async def stream_events(run_id: str, request: Request, after: int | None = None):
    log, live = _find_log(request, run_id)
    start = _after(request, after)

    async def frames() -> AsyncIterator[str]:
        events = log.subscribe(start) if live else _replay(log, start)
        async for event in events:
            yield f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _replay(log: EventLog, after: int) -> AsyncIterator[Event]:
    for event in log.read(after):
        yield event
