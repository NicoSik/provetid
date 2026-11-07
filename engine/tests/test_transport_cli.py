import asyncio
import json
import os

import pytest
from pydantic import BaseModel

from provetid.config import Settings
from provetid.transport import claude_cli
from provetid.transport.base import (
    CallFailed,
    LoginFailed,
    Refused,
    UsageLimitReached,
)
from provetid.transport.claude_cli import (
    MIN_CLAUDE_VERSION,
    ClaudeCliTransport,
    ProcessOutput,
    claude_version,
)


class Out(BaseModel):
    text: str
    n: int


def ok(payload: dict | None = None, cost: float = 0.01) -> ProcessOutput:
    body = {
        "is_error": False,
        "result": "",
        "total_cost_usd": cost,
        "structured_output": payload if payload is not None else {"text": "hei", "n": 1},
    }
    return ProcessOutput(0, json.dumps(body), "")


def err(result: str, code: int = 1) -> ProcessOutput:
    return ProcessOutput(code, json.dumps({"is_error": True, "result": result}), "")


class Runner:
    """Replaces the real process. Pops one scripted outcome per attempt."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.argvs: list[list[str]] = []
        self.cwds: list[str] = []
        self.cwd_listings: list[list[str]] = []
        self.cancelled = 0

    async def __call__(self, argv, cwd):
        self.argvs.append(argv)
        self.cwds.append(cwd)
        self.cwd_listings.append(os.listdir(cwd))
        outcome = self.outcomes.pop(0)
        if outcome == "sleep":
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
        return outcome


def make(runner, **kw) -> ClaudeCliTransport:
    settings = Settings(model_bot="haiku", effort_bot="low", **kw)
    return ClaudeCliTransport(settings, run_process=runner)


async def test_argv_and_empty_cwd():
    runner = Runner(ok())
    await make(runner).call("bot", "SYSTEM", "USER", Out)
    argv = runner.argvs[0]
    assert argv[:2] == ["claude", "-p"]
    assert "--safe-mode" in argv
    assert "--no-session-persistence" in argv
    assert argv[argv.index("--tools") + 1] == ""
    assert argv[argv.index("--model") + 1] == "haiku"
    assert argv[argv.index("--effort") + 1] == "low"
    assert argv[argv.index("--system-prompt") + 1] == "SYSTEM"
    assert argv[argv.index("--output-format") + 1] == "json"
    assert json.loads(argv[argv.index("--json-schema") + 1]) == Out.model_json_schema()
    assert argv[-1] == "USER"
    assert runner.cwd_listings[0] == []
    assert not os.path.exists(runner.cwds[0])  # temp folder is removed afterwards


async def test_success_returns_parsed_model_and_cost():
    result = await make(Runner(ok({"text": "hallo", "n": 7}, cost=0.25))).call("bot", "s", "u", Out)
    assert result.data == Out(text="hallo", n=7)
    assert result.cost_usd == 0.25


async def test_timeout_stops_process_twice_then_call_failed():
    runner = Runner("sleep", "sleep")
    with pytest.raises(CallFailed):
        await make(runner, call_timeout_s=0.1).call("bot", "s", "u", Out)
    assert len(runner.argvs) == 2
    assert runner.cancelled == 2


async def test_generic_failure_is_retried_once():
    runner = Runner(err("something odd"), ok())
    result = await make(runner).call("bot", "s", "u", Out)
    assert result.data == Out(text="hei", n=1)
    assert len(runner.argvs) == 2


async def test_generic_failure_twice_raises_call_failed():
    runner = Runner(err("odd"), err("odd"))
    with pytest.raises(CallFailed):
        await make(runner).call("bot", "s", "u", Out)
    assert len(runner.argvs) == 2


@pytest.mark.parametrize(
    ("text", "exc"),
    [
        ("Claude AI usage limit reached|1760000000", UsageLimitReached),
        ("You've hit your limit · resets 5pm", UsageLimitReached),
        ("Invalid API key · Please run /login", LoginFailed),
        ("Not logged in", LoginFailed),
        ("I can't help with that request, so I refuse.", Refused),
    ],
)
async def test_specific_errors_are_not_retried(text, exc):
    runner = Runner(err(text), ok())
    with pytest.raises(exc):
        await make(runner).call("bot", "s", "u", Out)
    assert len(runner.argvs) == 1


async def test_refusal_stop_reason_is_refused():
    body = {"is_error": False, "result": "", "stop_reason": "refusal", "total_cost_usd": 0}
    runner = Runner(ProcessOutput(0, json.dumps(body), ""))
    with pytest.raises(Refused):
        await make(runner).call("bot", "s", "u", Out)
    assert len(runner.argvs) == 1


async def test_schema_mismatch_retries_once_then_call_failed():
    runner = Runner(ok({"text": "no n"}), ok({"text": "still no n"}))
    with pytest.raises(CallFailed):
        await make(runner).call("bot", "s", "u", Out)
    assert len(runner.argvs) == 2


async def test_non_json_stdout_is_call_failed():
    runner = Runner(ProcessOutput(0, "garbage", ""), ProcessOutput(0, "garbage", ""))
    with pytest.raises(CallFailed):
        await make(runner).call("bot", "s", "u", Out)


def test_claude_version_parses(monkeypatch):
    class Done:
        stdout = "2.1.319 (Claude Code)\n"

    monkeypatch.setattr(claude_cli.subprocess, "run", lambda *a, **k: Done())
    assert claude_version() == (2, 1, 319)
    assert MIN_CLAUDE_VERSION == (2, 1, 319)
