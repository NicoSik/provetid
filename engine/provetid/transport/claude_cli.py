"""Transport that runs every model call through `claude -p`."""

import asyncio
import json
import re
import subprocess
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from provetid.config import Settings
from provetid.transport.base import (
    CallFailed,
    CallResult,
    LoginFailed,
    Refused,
    Role,
    TransportError,
    UsageLimitReached,
)

MIN_CLAUDE_VERSION = (2, 1, 319)

# One table maps the error text of `claude -p` to a transport error. The first match wins.
# Anything that matches no row is a CallFailed, which the transport retries once.
ERROR_PATTERNS: list[tuple[re.Pattern[str], type[TransportError]]] = [
    (
        re.compile(r"usage limit|hit your limit|rate limit|limit reached|quota", re.I),
        UsageLimitReached,
    ),
    (
        re.compile(r"not logged in|/login|invalid api key|authentication|unauthorized|oauth", re.I),
        LoginFailed,
    ),
    (re.compile(r"\brefus|can't help with|cannot help with|unable to assist", re.I), Refused),
]


@dataclass(frozen=True)
class ProcessOutput:
    returncode: int
    stdout: str
    stderr: str


RunProcess = Callable[[list[str], str], Awaitable[ProcessOutput]]


async def run_subprocess(argv: list[str], cwd: str) -> ProcessOutput:
    """Run argv in cwd. Kills the process when the task is cancelled (for example on timeout)."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await proc.communicate()
    except BaseException:
        proc.kill()
        await proc.wait()
        raise
    return ProcessOutput(
        proc.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace")
    )


def classify(text: str) -> type[TransportError]:
    for pattern, error in ERROR_PATTERNS:
        if pattern.search(text):
            return error
    return CallFailed


def claude_version() -> tuple[int, int, int]:
    out = subprocess.run(
        ["claude", "--version"], capture_output=True, text=True, check=True, timeout=30
    ).stdout
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", out)
    if not match:
        raise CallFailed(f"Cannot read the Claude Code version from {out!r}")
    major, minor, patch = (int(g) for g in match.groups())
    return (major, minor, patch)


class ClaudeCliTransport:
    def __init__(self, settings: Settings, run_process: RunProcess = run_subprocess) -> None:
        self._settings = settings
        self._run_process = run_process

    async def call(
        self, role: Role, system_prompt: str, user_input: str, output: type[BaseModel]
    ) -> CallResult:
        try:
            return await self._attempt(role, system_prompt, user_input, output)
        except CallFailed:
            return await self._attempt(role, system_prompt, user_input, output)

    def _argv(self, role: Role, system_prompt: str, user_input: str, output: type[BaseModel]):
        s = self._settings
        return [
            "claude",
            "-p",
            "--safe-mode",
            "--no-session-persistence",
            "--tools",
            "",
            "--model",
            getattr(s, f"model_{role}"),
            "--effort",
            getattr(s, f"effort_{role}"),
            "--system-prompt",
            system_prompt,
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(output.model_json_schema()),
            "--",
            user_input,
        ]

    async def _attempt(
        self, role: Role, system_prompt: str, user_input: str, output: type[BaseModel]
    ) -> CallResult:
        argv = self._argv(role, system_prompt, user_input, output)
        with tempfile.TemporaryDirectory(prefix="provetid-") as cwd:
            try:
                proc = await asyncio.wait_for(
                    self._run_process(argv, cwd), timeout=self._settings.call_timeout_s
                )
            except TimeoutError:
                raise CallFailed(f"{role} call timed out") from None
            except OSError as e:
                raise CallFailed(f"Cannot start claude: {e}") from e
        return self._parse(proc, output)

    @staticmethod
    def _parse(proc: ProcessOutput, output: type[BaseModel]) -> CallResult:
        try:
            body = json.loads(proc.stdout)
            if not isinstance(body, dict):
                raise ValueError("not an object")
        except ValueError:
            text = f"{proc.stdout}\n{proc.stderr}".strip()
            raise classify(text)(
                f"claude gave no JSON (exit {proc.returncode}): {text[:300]}"
            ) from None
        result_text = str(body.get("result") or "")
        if body.get("stop_reason") == "refusal":
            raise Refused(result_text or "The model refused")
        if body.get("is_error") or proc.returncode != 0:
            text = f"{result_text}\n{proc.stderr}".strip()
            raise classify(text)(text[:300] or f"claude failed (exit {proc.returncode})")
        try:
            data = output.model_validate(body.get("structured_output"))
        except ValidationError as e:
            raise CallFailed(f"Output does not match the schema: {e}") from e
        return CallResult(data=data, cost_usd=float(body.get("total_cost_usd") or 0.0))
