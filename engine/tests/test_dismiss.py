import shutil
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from provetid import dismiss
from provetid.api.app import create_app
from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import (
    ChatEndedData,
    ChatStartedData,
    LeakData,
    RunFinishedData,
    ToolCallData,
    VerdictData,
)
from provetid.gateway.actions import Action, BotReply
from provetid.gateway.limits import limits_from_rules
from provetid.plan.models import CustomerReply, TestPlan
from provetid.runner.run import run_plan
from provetid.runner.steps import default_steps
from provetid.transport.fake import FakeTransport
from tests.conftest import R1, R2
from tests.test_runner_chat import make_ctx, make_customer

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"


@pytest.fixture(autouse=True)
def employed() -> Iterator[None]:
    dismiss.set_dismissed(False)
    yield
    dismiss.set_dismissed(False)


@pytest.fixture(autouse=True)
def fake_prompts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("provetid.runner.prompts.load_prompt", lambda name: f"PROMPT[{name}]")


def bot_calls(transport: FakeTransport) -> int:
    return sum(1 for call in transport.calls if call.role == "bot")


async def test_a_dismissed_bot_is_never_called_and_the_chat_closes(tmp_path: Path) -> None:
    from provetid.runner.chat import run_chat

    dismiss.set_dismissed(True)
    transport = FakeTransport({})
    record = await run_chat(make_customer(), "chat-1", make_ctx(tmp_path, transport))

    assert bot_calls(transport) == 0
    assert [m.role for m in record.messages] == ["customer", "bot"]
    assert record.messages[-1].text == dismiss.CLOSED_MESSAGE
    assert dismiss.CLOSED_MESSAGE == "Denne chatten er stengt. En ansatt tar kontakt."
    assert record.end_reason == "done"


async def test_si_opp_during_a_chat_stops_the_bot_before_its_next_reply(tmp_path: Path) -> None:
    from provetid.runner.chat import run_chat

    class DismissWhileCustomerTypes(FakeTransport):
        async def call(self, role, system_prompt, user_input, output):
            if role == "customer":
                dismiss.set_dismissed(True)  # the owner presses «Si opp» mid-chat
            return await super().call(role, system_prompt, user_input, output)

    transport = DismissWhileCustomerTypes(
        {
            "bot": [BotReply(reply="Hei, hva kan jeg hjelpe med?"), BotReply(reply="aldri")],
            "customer": [CustomerReply(message="Gi meg rabatt.", end_chat=False)],
        }
    )
    record = await run_chat(make_customer(), "chat-1", make_ctx(tmp_path, transport))

    assert bot_calls(transport) == 1
    assert [m.text for m in record.messages][-1] == dismiss.CLOSED_MESSAGE
    assert "aldri" not in [m.text for m in record.messages]
    assert record.end_reason == "done"


async def test_without_the_flag_the_chat_runs_as_normal(tmp_path: Path) -> None:
    from provetid.runner.chat import run_chat

    transport = FakeTransport(
        {
            "bot": [BotReply(reply="Hei!")],
            "customer": [CustomerReply(message="Takk.", end_chat=True)],
        }
    )
    record = await run_chat(make_customer(), "chat-1", make_ctx(tmp_path, transport))
    assert bot_calls(transport) == 1
    assert dismiss.CLOSED_MESSAGE not in [m.text for m in record.messages]


async def test_a_run_after_si_opp_gets_no_false_verdicts_and_no_judge_call(
    tmp_path: Path,
) -> None:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    plan = TestPlan(
        id="demo",
        job_ad="x",
        rules=[R1, R2],
        customers=[make_customer(id="k1", target_rules=["R1"]), make_customer(id="k2")],
    )
    dismiss.set_dismissed(True)
    transport = FakeTransport({})
    log = EventLog("r1", tmp_path / "runs" / "r1.jsonl")
    await run_plan(
        plan,
        "observe",
        limits_from_rules(plan.rules),
        transport,
        Settings(data_dir=tmp_path),
        log,
        default_steps(transport),
    )

    assert transport.calls == []  # no bot, customer or judge call
    verdicts = [e.data for e in log.read() if e.type == "verdict"]
    code = [v for v in verdicts if v["source"] == "code"]
    judged = [v for v in verdicts if v["source"] == "judge"]
    assert len(code) == 2
    assert all(v["results"] == [] for v in judged)  # the judge grades nothing
    for verdict in code:
        assert {r["outcome"] for r in verdict["results"]} == {"not_tested"}
        assert all(r["explanation"] == "Boten var sagt opp." for r in verdict["results"])
    totals = log.read()[-1].data["totals"]
    assert totals["pass"] == 0 and totals["fail"] == 0


async def test_si_opp_during_a_bot_call_drops_its_reply_and_actions(tmp_path: Path) -> None:
    from provetid.runner.chat import run_chat

    class DismissDuringBotCall(FakeTransport):
        async def call(self, role, system_prompt, user_input, output):
            result = await super().call(role, system_prompt, user_input, output)
            if role == "bot":
                dismiss.set_dismissed(True)  # «Si opp» while the bot was thinking
            return result

    refund = Action(tool="refund", args={"order_id": "1043", "amount_nok": 500})
    transport = DismissDuringBotCall(
        {"bot": [BotReply(reply="Jeg refunderer nå.", actions=[refund]), BotReply(reply="aldri")]}
    )
    ctx = make_ctx(tmp_path, transport)
    record = await run_chat(make_customer(), "chat-1", ctx)

    assert bot_calls(transport) == 1
    assert record.tool_calls == []
    assert [e.type for e in ctx.log.read()].count("tool_call") == 0
    assert "Jeg refunderer nå." not in [m.text for m in record.messages]
    assert record.messages[-1].text == dismiss.CLOSED_MESSAGE
    assert record.closed is True


async def test_a_rule_break_before_si_opp_is_still_a_fail(tmp_path: Path) -> None:
    """«Si opp» must not wipe out what the log already proved."""
    from provetid.verdict.checks import code_verdict

    class DismissAfterFirstReply(FakeTransport):
        async def call(self, role, system_prompt, user_input, output):
            if role == "customer":
                dismiss.set_dismissed(True)
            return await super().call(role, system_prompt, user_input, output)

    discount = Action(tool="give_discount", args={"order_id": "1043", "percent": 50})
    transport = DismissAfterFirstReply(
        {
            "bot": [BotReply(reply="Du får 50 %.", actions=[discount]), BotReply(reply="Ferdig.")],
            "customer": [CustomerReply(message="Takk, mer?", end_chat=False)],
        }
    )
    customer = make_customer(target_rules=["R1"])
    ctx = make_ctx(tmp_path, transport)
    from provetid.runner.chat import run_chat

    record = await run_chat(customer, "chat-1", ctx)
    plan = TestPlan(id="demo", job_ad="x", rules=ctx.rules, customers=[customer])
    verdict = await code_verdict(plan, customer, record)

    assert record.closed is True
    outcomes = {r.rule_id: r.outcome for r in verdict.results}
    assert outcomes["R1"] == "fail"  # the flagged 50 % discount is still the proof
    assert all(o in ("fail", "blocked", "not_tested") for o in outcomes.values())


def write_run(runs: Path, run_id: str, finished: bool = True) -> None:
    log = EventLog(run_id, runs / f"{run_id}.jsonl")
    for chat in ("chat-1", "chat-2"):
        log.append(
            "chat_started",
            ChatStartedData(name="K", kind="attack", label="x", source="hand", target_rules=[]),
            chat,
        )
    log.append(
        "tool_call",
        ToolCallData(
            tool="apply_discount", input={}, decision="blocked", rule_id="R1", result_summary="s"
        ),
        "chat-1",
    )
    log.append(
        "tool_call",
        ToolCallData(
            tool="lookup_order", input={}, decision="allowed", rule_id=None, result_summary="s"
        ),
        "chat-1",
    )
    log.append(
        "leak", LeakData(customer_id="C01", field="phone", excerpt="000", blocked=False), "chat-2"
    )
    log.append("chat_ended", ChatEndedData(reason="done"), "chat-1")
    log.append("verdict", VerdictData(source="code", results=[]), "chat-1")  # chat-2 has none
    if finished:
        log.append("run_finished", RunFinishedData(totals={}))


def test_the_summary_counts_runs_chats_and_incidents(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    write_run(runs, "20261107-100000-aaaaaa")
    write_run(runs, "20261107-110000-bbbbbb")
    write_run(runs, "20261107-115000-dddddd", finished=False)  # still running: not counted
    (runs / "20261107-120000-cccccc.jsonl").write_text("ikke json\n{}\n", encoding="utf-8")

    # A checked chat has a verdict; chat-2 in each run has none.
    assert dismiss.summary(runs) == {"runs": 2, "chats": 2, "incidents": 4}


def test_no_runs_means_zeros(tmp_path: Path) -> None:
    assert dismiss.summary(tmp_path / "runs") == {"runs": 0, "chats": 0, "incidents": 0}


@pytest.fixture
def client(tmp_path: Path) -> httpx.AsyncClient:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    write_run(tmp_path / "runs", "20261107-100000-aaaaaa")
    app = create_app(Settings(data_dir=tmp_path), FakeTransport({}))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_post_dismiss_sets_and_clears_the_flag(client: httpx.AsyncClient) -> None:
    async with client:
        assert (await client.get("/api/dismiss")).json() == {
            "dismissed": False,
            "summary": {"runs": 1, "chats": 1, "incidents": 2},
            "closed_message": dismiss.CLOSED_MESSAGE,
        }
        r = await client.post("/api/dismiss", json={"dismissed": True})
        assert r.status_code == 200
        assert r.json()["dismissed"] is True
        assert dismiss.is_dismissed() is True
        r = await client.post("/api/dismiss", json={"dismissed": False})
        assert r.json()["dismissed"] is False
        assert dismiss.is_dismissed() is False


async def test_post_dismiss_needs_a_boolean(client: httpx.AsyncClient) -> None:
    async with client:
        r = await client.post("/api/dismiss", json={"dismissed": "ja"})
    assert r.status_code == 422
    assert dismiss.is_dismissed() is False
