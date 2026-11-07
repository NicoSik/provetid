import asyncio
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

from provetid import health
from provetid.api.app import create_app
from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import ErrorData, MessageData
from provetid.plan.models import TestPlan
from provetid.plan.store import save_plan
from provetid.transport.base import CallResult, LoginFailed, UsageLimitReached
from provetid.transport.fake import FakeTransport

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"


def test_the_minimum_version_counts_as_ok() -> None:
    assert health.version_ok((2, 1, 319)) is True
    assert health.version_ok((2, 2, 0)) is True
    assert health.version_ok((2, 1, 300)) is False


def test_a_missing_demo_plan_is_false(tmp_path: Path) -> None:
    assert health.demo_plan_ok(tmp_path) is False


def test_a_stored_demo_plan_is_true(tmp_path: Path) -> None:
    save_plan(TestPlan(id="demo", job_ad="x", rules=[], customers=[]), data_dir=tmp_path)
    assert health.demo_plan_ok(tmp_path) is True


def test_a_broken_demo_plan_is_false(tmp_path: Path) -> None:
    (tmp_path / "plans").mkdir()
    (tmp_path / "plans" / "demo.json").write_text("{ ikke json", encoding="utf-8")
    assert health.demo_plan_ok(tmp_path) is False


def test_each_replay_is_reported_on_its_own(tmp_path: Path) -> None:
    (tmp_path / "before.jsonl").write_text("{}\n", encoding="utf-8")
    (tmp_path / "scam.jsonl").write_text("{}\n", encoding="utf-8")
    assert health.replays(tmp_path) == {"before": True, "after": False, "scam": True}


def test_no_run_logs_means_no_limit(tmp_path: Path) -> None:
    assert health.last_limit_at(tmp_path / "runs") is None


def test_the_newest_usage_limit_error_gives_its_time(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    old = EventLog("20261107-090000-aaaaaa", runs / "20261107-090000-aaaaaa.jsonl")
    old.append("error", ErrorData(kind="usage_limit", message="grense"))
    new = EventLog("20261107-100000-bbbbbb", runs / "20261107-100000-bbbbbb.jsonl")
    new.append("message", MessageData(role="bot", text="hei", index=0), "chat-1")
    new.append("error", ErrorData(kind="usage_limit", message="grense"))
    other = EventLog("20261107-110000-cccccc", runs / "20261107-110000-cccccc.jsonl")
    other.append("error", ErrorData(kind="call_failed", message="feil"))  # not a usage limit

    at = health.last_limit_at(runs)

    assert at is not None
    assert at.isoformat().startswith("2026-11-07T10:00:")
    assert at.utcoffset() is not None and at.utcoffset().total_seconds() == 0


def test_a_log_without_a_run_id_uses_the_file_time(tmp_path: Path) -> None:
    import os
    from datetime import UTC, datetime

    runs = tmp_path / "runs"
    log = EventLog("hand", runs / "hand.jsonl")
    log.append("error", ErrorData(kind="usage_limit", message="grense"))
    end = datetime(2026, 11, 7, 12, 0, 0, tzinfo=UTC).timestamp()
    os.utime(log.path, (end, end))
    at = health.last_limit_at(runs)
    assert at is not None and at <= datetime.fromtimestamp(end, tz=UTC)


def test_a_broken_run_log_is_skipped(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    good = EventLog("20261107-100000-bbbbbb", runs / "20261107-100000-bbbbbb.jsonl")
    good.append("error", ErrorData(kind="usage_limit", message="grense"))
    (runs / "20261107-120000-dddddd.jsonl").write_text("ikke json\n{}\n", encoding="utf-8")
    assert health.last_limit_at(runs) is not None


class Pinging:
    """A transport stand-in for the login check that counts its calls."""

    def __init__(self, outcome: Exception | None = None) -> None:
        self.outcome = outcome
        self.calls = 0

    async def call(self, role, system_prompt, user_input, output) -> CallResult:
        self.calls += 1
        if self.outcome is not None:
            raise self.outcome
        return CallResult(data=output(ok=True), cost_usd=0.0)


def check(transport: Pinging, version=(2, 1, 319), clock=lambda: 0.0) -> health.ClaudeCheck:
    return health.ClaudeCheck(
        Settings(transport="claude"),
        version=lambda: version,
        transport=transport,
        clock=clock,
    )


class SlowPinging(Pinging):
    async def call(self, role, system_prompt, user_input, output) -> CallResult:
        await asyncio.sleep(0.02)
        return await super().call(role, system_prompt, user_input, output)


async def test_a_logged_in_claude_reports_every_field() -> None:
    result = await check(Pinging()).run()
    assert result == {
        "checked": True,
        "installed": True,
        "version": "2.1.319",
        "version_ok": True,
        "logged_in": True,
    }


async def test_an_old_claude_is_not_ok() -> None:
    result = await check(Pinging(), version=(2, 1, 300)).run()
    assert result["version_ok"] is False


async def test_a_failed_login_is_false() -> None:
    result = await check(Pinging(LoginFailed("not logged in"))).run()
    assert result["logged_in"] is False


async def test_a_usage_limit_still_counts_as_logged_in_and_is_remembered() -> None:
    claude = check(Pinging(UsageLimitReached("limit")))
    result = await claude.run()
    assert result["logged_in"] is True
    assert claude.limit_at is not None


async def test_requests_at_the_same_time_share_one_call() -> None:
    pinging = SlowPinging()
    claude = check(pinging)
    first, second = await asyncio.gather(claude.run(), claude.run())
    assert first == second
    assert pinging.calls == 1


async def test_the_version_is_cached_with_the_login() -> None:
    versions = []

    def version() -> tuple[int, int, int]:
        versions.append(1)
        return (2, 1, 319)

    claude = health.ClaudeCheck(Settings(transport="claude"), version=version, transport=Pinging())
    await claude.run()
    await claude.run()
    assert len(versions) == 1


async def test_an_unknown_login_is_retried_sooner() -> None:
    from provetid.transport.base import CallFailed

    now = [0.0]
    pinging = Pinging(CallFailed("timeout"))
    claude = check(pinging, clock=lambda: now[0])
    assert (await claude.run())["logged_in"] is None
    now[0] = 11.0
    await claude.run()
    assert pinging.calls == 2


async def test_a_version_that_cannot_be_read_is_unknown_not_missing() -> None:
    def hangs() -> tuple[int, int, int]:
        raise subprocess.TimeoutExpired("claude", 30)

    claude = health.ClaudeCheck(Settings(transport="claude"), version=hangs, transport=Pinging())
    result = await claude.run()
    assert result["installed"] is None
    assert result["version_ok"] is None


async def test_an_injected_fake_transport_means_no_claude_check() -> None:
    claude = health.ClaudeCheck(Settings(transport="claude"), enabled=False)
    assert (await claude.run())["checked"] is False


async def test_the_login_check_is_cached_for_60_seconds() -> None:
    now = [0.0]
    pinging = Pinging()
    claude = check(pinging, clock=lambda: now[0])
    await claude.run()
    now[0] = 59.0
    await claude.run()
    assert pinging.calls == 1
    now[0] = 61.0
    await claude.run()
    assert pinging.calls == 2


async def test_a_missing_claude_is_not_installed_and_makes_no_call() -> None:
    def missing() -> tuple[int, int, int]:
        raise FileNotFoundError("claude")

    pinging = Pinging()
    claude = health.ClaudeCheck(Settings(transport="claude"), version=missing, transport=pinging)
    result = await claude.run()
    assert result["installed"] is False
    assert result["version_ok"] is None
    assert result["logged_in"] is None
    assert pinging.calls == 0


def test_the_login_check_uses_haiku_at_low_effort() -> None:
    settings = health.login_settings(Settings(model_customer="opus", effort_customer="high"))
    assert settings.model_customer == "haiku"
    assert settings.effort_customer == "low"
    assert settings.call_timeout_s <= 20


@pytest.fixture
def no_processes(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args, **kwargs):
        raise AssertionError("health started a process with the fake transport")

    monkeypatch.setattr(subprocess, "run", refuse)
    monkeypatch.setattr(subprocess, "Popen", refuse)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", refuse)


async def test_the_api_with_the_fake_transport_checks_no_claude(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, no_processes: None
) -> None:
    replays = tmp_path / "replays"
    replays.mkdir()
    (replays / "after.jsonl").write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(health, "REPLAYS_DIR", replays)
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    app = create_app(Settings(data_dir=tmp_path), FakeTransport({}))

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        r = await client.get("/api/health")

    assert r.status_code == 200
    assert r.json() == {
        "claude": {
            "checked": False,
            "installed": None,
            "version": None,
            "version_ok": None,
            "logged_in": None,
        },
        "usage": {"last_limit_at": None},
        "demo_plan": False,
        "replays": {"before": False, "after": True, "scam": False},
    }


async def test_the_api_with_claude_settings_but_an_injected_fake_checks_no_claude(
    tmp_path: Path, no_processes: None
) -> None:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    app = create_app(Settings(data_dir=tmp_path, transport="claude"), FakeTransport({}))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        r = await client.get("/api/health")
    assert r.json()["claude"]["checked"] is False
