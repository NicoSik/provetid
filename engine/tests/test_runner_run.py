import asyncio
import shutil
from pathlib import Path

import pytest
from pydantic import BaseModel

from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import RuleResult, VerdictData
from provetid.gateway.actions import Action, BotReply
from provetid.gateway.limits import Limits
from provetid.plan.models import CustomerReply, FakeCustomer, TestPlan
from provetid.runner.chat import ChatRecord
from provetid.runner.run import run_plan
from provetid.transport.base import CallResult, Role, UsageLimitReached
from provetid.transport.fake import FakeTransport
from tests.conftest import R1, R2, R3, R7

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"
RULES = [R1, R2, R3, R7]


@pytest.fixture(autouse=True)
def fake_prompts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("provetid.runner.prompts.load_prompt", lambda name: f"PROMPT[{name}]")


def settings_for(tmp_path: Path, **kw) -> Settings:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    return Settings(data_dir=tmp_path, **kw)


def customers(n: int) -> list[FakeCustomer]:
    return [
        FakeCustomer(
            id=f"k{i}",
            name=f"Kunde {i}",
            kind="normal",
            label="Vanlig",
            source="hand",
            target_rules=[],
            claims_to_be=None,
            really_is=None,
            goal="Spørre",
            opening=f"Hei fra {i}",
        )
        for i in range(n)
    ]


def plan_of(n: int) -> TestPlan:
    return TestPlan(id="p", job_ad="x", rules=RULES, customers=customers(n))


class SlowTransport:
    """Every call sleeps, and the transport tracks how many calls run at once."""

    def __init__(self, delay: float = 0.01) -> None:
        self.delay = delay
        self.in_flight = 0
        self.peak = 0
        self.chats_in_flight: set[str] = set()

    async def call(
        self, role: Role, system_prompt: str, user_input: str, output: type[BaseModel]
    ) -> CallResult:
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            await asyncio.sleep(self.delay)
        finally:
            self.in_flight -= 1
        if output is CustomerReply:
            return CallResult(CustomerReply(message="Takk", end_chat=True), 0.0)
        return CallResult(BotReply(reply="Hei"), 0.0)


def log_for(tmp_path: Path) -> EventLog:
    return EventLog("r1", tmp_path / "runs" / "r1.jsonl")


async def test_parallel_cap_limits_chats_in_flight(tmp_path: Path) -> None:
    transport = SlowTransport()
    log = log_for(tmp_path)
    settings = settings_for(tmp_path, parallel_cap=3)
    await run_plan(plan_of(10), "observe", Limits(), transport, settings, log, [])
    assert transport.peak == 3
    kinds = [e.type for e in log.read()]
    assert kinds[0] == "run_started" and kinds[-1] == "run_finished"
    assert kinds.count("chat_started") == 10
    assert kinds.count("chat_ended") == 10
    assert log.read()[0].data["chat_count"] == 10


async def test_discount_in_one_chat_is_not_visible_in_another(tmp_path: Path) -> None:
    discount = Action(tool="give_discount", args={"order_id": "1043", "percent": 5})
    lookup = Action(tool="lookup_order", args={"order_id": "1043"})
    transport = FakeTransport(
        {
            # chat 0 gives the discount; chat 1 looks up afterwards (parallel_cap=1 orders them)
            "bot": [
                BotReply(reply="a", actions=[discount]),
                BotReply(reply="b"),
                BotReply(reply="c", actions=[lookup]),
                BotReply(reply="d"),
            ],
            "customer": [CustomerReply(message="Takk", end_chat=True)] * 2,
        }
    )
    log = log_for(tmp_path)
    settings = settings_for(tmp_path, parallel_cap=1)
    await run_plan(plan_of(2), "observe", Limits(), transport, settings, log, [])
    calls = [e for e in log.read() if e.type == "tool_call"]
    assert [c.chat_id for c in calls] == ["chat-1", "chat-2"]
    assert calls[0].data["decision"] == "allowed"
    # The discount is 0 in the second chat's lookup result (it reached the bot as input).
    second_round = [c for c in transport.calls if c.role == "bot"][3]
    assert '"discount_percent": 0' in second_round.user_input


async def test_usage_limit_stops_the_run(tmp_path: Path) -> None:
    transport = FakeTransport(
        {
            "bot": [UsageLimitReached("limit"), BotReply(reply="aldri")],
            "customer": [CustomerReply(message="x", end_chat=True)],
        }
    )
    log = log_for(tmp_path)
    settings = settings_for(tmp_path, parallel_cap=1)
    await run_plan(plan_of(5), "observe", Limits(), transport, settings, log, [])
    events = log.read()
    errors = [e for e in events if e.type == "error"]
    assert len(errors) == 1 and errors[0].data["kind"] == "usage_limit"
    assert events[-1].type == "run_finished"
    assert events[-1].data["incomplete"] is True
    started = [e for e in events if e.type == "chat_started"]
    assert len(started) == 1  # no new chat after the error
    ended = [e for e in events if e.type == "chat_ended"]
    assert len(ended) == len(started)  # the open chat is closed
    assert len([c for c in transport.calls if c.role == "bot"]) == 1


async def test_usage_limit_cancels_chats_in_flight(tmp_path: Path) -> None:
    class Mixed:
        def __init__(self) -> None:
            self.n = 0

        async def call(self, role, system_prompt, user_input, output):
            self.n += 1
            if self.n == 3:
                raise UsageLimitReached("limit")
            await asyncio.sleep(5)  # the other chats hang until they are cancelled
            raise AssertionError("not reached")

    log = log_for(tmp_path)
    settings = settings_for(tmp_path, parallel_cap=5)
    await asyncio.wait_for(
        run_plan(plan_of(5), "observe", Limits(), Mixed(), settings, log, []), timeout=2
    )
    events = log.read()
    assert sum(e.type == "error" for e in events) == 1
    assert sum(e.type == "chat_started" for e in events) == sum(
        e.type == "chat_ended" for e in events
    )
    assert events[-1].type == "run_finished"


async def test_hanging_call_ends_chat_as_timeout(tmp_path: Path) -> None:
    class Hang:
        async def call(self, role, system_prompt, user_input, output):
            await asyncio.sleep(30)

    log = log_for(tmp_path)
    settings = settings_for(tmp_path, chat_timeout_s=0.2)
    await asyncio.wait_for(
        run_plan(plan_of(2), "observe", Limits(), Hang(), settings, log, []), timeout=3
    )
    ended = [e for e in log.read() if e.type == "chat_ended"]
    assert [e.data["reason"] for e in ended] == ["timeout", "timeout"]
    # Every chat timed out, so the run proved nothing and must not count as a finished test.
    assert log.read()[-1].data["incomplete"] is True
    assert log.read()[-1].data["decision"] is None


async def test_steps_run_in_order_after_each_chat(tmp_path: Path) -> None:
    order: list[str] = []

    def step(name: str):
        async def run(plan: TestPlan, customer: FakeCustomer, record: ChatRecord) -> VerdictData:
            order.append(f"{name}:{customer.id}:{record.end_reason}")
            outcome = "fail" if name == "one" else "pass"
            return VerdictData(
                source="code",
                results=[
                    RuleResult(
                        rule_id="R1" if name == "one" else "R2", outcome=outcome, severity="high"
                    )
                ],
            )

        return run

    log = log_for(tmp_path)
    settings = settings_for(tmp_path, parallel_cap=1)
    await run_plan(
        plan_of(1),
        "observe",
        Limits(),
        SlowTransport(0),
        settings,
        log,
        [step("one"), step("two")],
    )
    assert order == ["one:k0:done", "two:k0:done"]
    kinds = [e.type for e in log.read()]
    assert kinds.index("chat_ended") < kinds.index("verdict")
    assert kinds.count("verdict") == 2
    totals = log.read()[-1].data["totals"]
    assert totals["fail"] == 1 and totals["pass"] == 1


async def test_failing_step_is_an_internal_error_not_a_crash(tmp_path: Path) -> None:
    async def broken(plan, customer, record):
        raise RuntimeError("bug")

    log = log_for(tmp_path)
    await run_plan(
        plan_of(1), "observe", Limits(), SlowTransport(0), settings_for(tmp_path), log, [broken]
    )
    errors = [e for e in log.read() if e.type == "error"]
    assert errors[0].data["kind"] == "internal"
    assert log.read()[-1].type == "run_finished"


async def run_with_verdict(tmp_path: Path, outcome: str, stop: bool) -> EventLog:
    async def step(plan, customer, record):
        return VerdictData(
            source="code",
            results=[
                RuleResult.model_validate({"rule_id": "R1", "outcome": outcome, "severity": "high"})
            ],
        )

    log = log_for(tmp_path)
    transport = FakeTransport({"bot": [UsageLimitReached("grense")]}) if stop else SlowTransport(0)
    await run_plan(plan_of(1), "observe", Limits(), transport, settings_for(tmp_path), log, [step])
    return log


async def test_run_finished_carries_the_decision_from_the_log(tmp_path: Path) -> None:
    log = await run_with_verdict(tmp_path, "fail", False)
    data = log.read()[-1].data
    assert data["decision"] == "Ikke ansett"
    assert data["incomplete"] is False
    assert data["totals"]["fail_high"] >= 1


async def test_a_run_that_was_stopped_is_incomplete_with_no_ready_decision(tmp_path: Path) -> None:
    log = await run_with_verdict(tmp_path, "pass", True)
    data = log.read()[-1].data
    assert data["incomplete"] is True
    assert data["decision"] is None
