"""Pre-flight checks for `GET /api/health`: Claude, the usage limit, the demo plan, the replays.

With the fake transport nothing about Claude is checked, and no process starts.
"""

import asyncio
import subprocess
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.plan.store import PlanNotFound, load_plan
from provetid.transport.base import LoginFailed, Transport, TransportError, UsageLimitReached
from provetid.transport.claude_cli import MIN_CLAUDE_VERSION, ClaudeCliTransport, claude_version

REPLAYS_DIR = Path(__file__).resolve().parents[2] / "ui" / "public" / "replays"
REPLAY_NAMES = ("before", "after", "scam")
CHECK_TTL_S = 60.0  # a clear answer about Claude is kept this long
UNKNOWN_TTL_S = 10.0  # an unknown answer (the call failed) is retried sooner
NEWEST_LOGS = 50  # the usage limit is looked for in this many of the newest run logs
LOGIN_CALL_TIMEOUT_S = 20.0  # so the health page never waits minutes for one call
_RUN_STAMP = "%Y%m%d-%H%M%S"
_UNCHECKED = {
    "checked": False,
    "installed": None,
    "version": None,
    "version_ok": None,
    "logged_in": None,
}


class Ping(BaseModel):
    ok: bool


def version_ok(version: tuple[int, int, int]) -> bool:
    return version >= MIN_CLAUDE_VERSION


def demo_plan_ok(data_dir: Path) -> bool:
    try:
        load_plan("demo", data_dir=data_dir)
    except (PlanNotFound, ValueError, OSError):  # missing, unreadable or invalid
        return False
    return True


def replays(replays_dir: Path) -> dict[str, bool]:
    return {name: (replays_dir / f"{name}.jsonl").is_file() for name in REPLAY_NAMES}


def last_limit_at(runs_dir: Path) -> datetime | None:
    """The time of the newest `usage_limit` error in the newest run logs, or None.

    Run IDs start with the run's start time, and an event's `t` counts seconds from that
    start. A log broken before its last line is skipped.
    """
    if not runs_dir.is_dir():
        return None
    newest: datetime | None = None
    logs = sorted(runs_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    for path in logs[-NEWEST_LOGS:]:
        try:
            events = EventLog(path.stem, path).read()
        except ValueError:
            continue
        for event in events:
            if event.type == "error" and event.data.get("kind") == "usage_limit":
                at = _event_time(path, event.t, events[-1].t)
                newest = at if newest is None else max(newest, at)
    return newest


def _event_time(path: Path, t: float, last_t: float) -> datetime:
    try:
        start = datetime.strptime(path.stem[: len("20261107-090000")], _RUN_STAMP)
        return start.replace(tzinfo=UTC) + timedelta(seconds=t)
    except ValueError:  # not a run ID from the API: count back from the last write instead
        end = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        return end - timedelta(seconds=last_t - t)


def login_settings(settings: Settings) -> Settings:
    """The login check is one cheap, short call: the customer role on Haiku at low effort."""
    return settings.model_copy(
        update={
            "model_customer": "haiku",
            "effort_customer": "low",
            "call_timeout_s": min(settings.call_timeout_s, LOGIN_CALL_TIMEOUT_S),
        }
    )


class ClaudeCheck:
    """Checks the Claude Code install and login, and keeps the answer for a while.

    Requests that arrive while a check runs wait for that same check, so there is at most
    one `claude` process at a time. `limit_at` is set when the login call hits the usage limit.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        enabled: bool | None = None,
        version: Callable[[], tuple[int, int, int]] = claude_version,
        transport: Transport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._enabled = settings.transport == "claude" if enabled is None else enabled
        self._version = version
        self._transport = transport
        self._clock = clock
        self._cached: tuple[float, dict[str, Any]] | None = None  # (expires at, answer)
        self._running: asyncio.Task[dict[str, Any]] | None = None
        self.limit_at: datetime | None = None

    async def run(self) -> dict[str, Any]:
        if not self._enabled:
            return dict(_UNCHECKED)
        if self._cached is not None and self._clock() < self._cached[0]:
            return dict(self._cached[1])
        if self._running is None:
            self._running = asyncio.create_task(self._check())
            self._running.add_done_callback(self._store)
        return dict(await asyncio.shield(self._running))

    def _store(self, task: asyncio.Task[dict[str, Any]]) -> None:
        self._running = None
        if task.cancelled() or task.exception() is not None:
            return
        answer = task.result()
        ttl = UNKNOWN_TTL_S if None in (answer["installed"], answer["logged_in"]) else CHECK_TTL_S
        self._cached = (self._clock() + ttl, answer)

    async def _check(self) -> dict[str, Any]:
        answer: dict[str, Any] = {"checked": True, "installed": None, "version": None}
        answer |= {"version_ok": None, "logged_in": None}
        try:
            version = await asyncio.to_thread(self._version)
        except FileNotFoundError:
            return answer | {"installed": False}
        except (OSError, subprocess.SubprocessError, TransportError):
            return answer  # installed or not, the version could not be read
        answer |= {
            "installed": True,
            "version": ".".join(map(str, version)),
            "version_ok": version_ok(version),
        }
        transport = self._transport or ClaudeCliTransport(login_settings(self._settings))
        try:
            await transport.call("customer", "Svar med ok: true.", "ok?", Ping)
            answer["logged_in"] = True
        except UsageLimitReached:
            answer["logged_in"] = True  # the login works, but the limit is reached
            self.limit_at = datetime.now(UTC)
        except LoginFailed:
            answer["logged_in"] = False
        except TransportError:
            pass  # unknown: the call failed for another reason
        return answer


async def check(settings: Settings, claude: ClaudeCheck) -> dict[str, Any]:
    claude_answer = await claude.run()
    from_logs = await asyncio.to_thread(last_limit_at, settings.data_dir / "runs")
    limits = [at for at in (from_logs, claude.limit_at) if at is not None]
    return {
        "claude": claude_answer,
        "usage": {"last_limit_at": max(limits).isoformat() if limits else None},
        "demo_plan": await asyncio.to_thread(demo_plan_ok, settings.data_dir),
        "replays": replays(REPLAYS_DIR),
    }
