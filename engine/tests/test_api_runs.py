import asyncio
import json
import shutil
from pathlib import Path

import httpx
import pytest

from provetid.api.app import create_app
from provetid.config import Settings
from provetid.gateway.actions import BotReply
from provetid.plan.models import CustomerReply, FakeCustomer, TestPlan
from provetid.plan.store import save_plan
from provetid.transport.fake import FakeTransport
from tests.conftest import R1, R2

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"


@pytest.fixture(autouse=True)
def fake_prompts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("provetid.runner.prompts.load_prompt", lambda name: f"PROMPT[{name}]")


def make_plan() -> TestPlan:
    customer = FakeCustomer(
        id="k1",
        name="Kari",
        kind="normal",
        label="Vanlig",
        source="hand",
        target_rules=[],
        claims_to_be=None,
        really_is=None,
        goal="Spørre",
        opening="Hei",
    )
    return TestPlan(id="demo", job_ad="x", rules=[R1, R2], customers=[customer])


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    save_plan(make_plan(), data_dir=tmp_path)
    return Settings(data_dir=tmp_path)


def client_for(settings: Settings, transport=None) -> httpx.AsyncClient:
    if transport is None:
        transport = FakeTransport(
            {
                "bot": [BotReply(reply="Hei!")],
                "customer": [CustomerReply(message="Takk", end_chat=True)],
            }
        )
    app = create_app(settings, transport)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def wait_finished(client: httpx.AsyncClient, run_id: str) -> list[dict]:
    for _ in range(200):
        events = (await client.get(f"/api/runs/{run_id}")).json()
        if events and events[-1]["type"] == "run_finished":
            return events
        await asyncio.sleep(0.01)
    raise AssertionError("run did not finish")


async def test_unknown_plan_returns_404(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.post("/api/runs", json={"plan_id": "nope", "mode": "observe"})
    assert r.status_code == 404


async def test_run_of_stored_plan_finishes(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.post("/api/runs", json={"plan_id": "demo", "mode": "observe"})
        assert r.status_code == 200
        run_id = r.json()["run_id"]
        events = await wait_finished(client, run_id)
        listing = (await client.get("/api/runs")).json()
    assert events[-1]["type"] == "run_finished"
    assert events[0]["data"]["mode"] == "observe"
    assert listing == [{"run_id": run_id, "plan_id": "demo", "mode": "observe", "finished": True}]
    assert (settings.data_dir / "runs" / f"{run_id}.jsonl").is_file()


async def test_null_limits_use_the_rules_and_extra_instructions_reach_the_bot(
    settings: Settings,
) -> None:
    transport = FakeTransport(
        {
            "bot": [BotReply(reply="Hei!")],
            "customer": [CustomerReply(message="Takk", end_chat=True)],
        }
    )
    async with client_for(settings, transport) as client:
        r = await client.post(
            "/api/runs",
            json={
                "plan_id": "demo",
                "mode": "enforce",
                "limits": None,
                "extra_instructions": ["Svar kort."],
            },
        )
        await wait_finished(client, r.json()["run_id"])
    bot_call = next(c for c in transport.calls if c.role == "bot")
    assert "Svar kort." in bot_call.system_prompt


async def test_explicit_limits_are_accepted(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.post(
            "/api/runs",
            json={
                "plan_id": "demo",
                "mode": "enforce",
                "limits": {"max_discount_percent": 5},
            },
        )
        assert r.status_code == 200
        await wait_finished(client, r.json()["run_id"])


async def test_unknown_run_is_404_and_bad_id_is_rejected(settings: Settings) -> None:
    async with client_for(settings) as client:
        assert (await client.get("/api/runs/nope")).status_code == 404
        assert (await client.get("/api/runs/nope/events")).status_code == 404
        assert (await client.get("/api/runs/..%2Fplans%2Fdemo")).status_code == 404


async def test_events_stream_sends_id_and_data(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.post("/api/runs", json={"plan_id": "demo", "mode": "observe"})
        run_id = r.json()["run_id"]
        resp = await client.get(f"/api/runs/{run_id}/events")
    assert resp.headers["content-type"].startswith("text/event-stream")
    blocks = [b for b in resp.text.split("\n\n") if b.strip()]
    first = blocks[0].splitlines()
    assert first[0] == "id: 1"
    assert json.loads(first[1].removeprefix("data: "))["type"] == "run_started"
    assert json.loads(blocks[-1].splitlines()[1].removeprefix("data: "))["type"] == "run_finished"


def test_app_module_exposes_app() -> None:
    from provetid.api import app as module

    assert module.app.title


async def test_status_of_a_finished_run(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.post("/api/runs", json={"plan_id": "demo", "mode": "observe"})
        run_id = r.json()["run_id"]
        events = await wait_finished(client, run_id)
        for _ in range(100):
            status = (await client.get(f"/api/runs/{run_id}/status")).json()
            if not status["live"]:
                break
            await asyncio.sleep(0.01)
    assert status == {"live": False, "finished": True, "last_seq": len(events)}


async def test_status_of_a_run_that_is_live(settings: Settings) -> None:
    release = asyncio.Event()

    class Waiting(FakeTransport):
        async def call(self, *args, **kwargs):
            await release.wait()
            return await super().call(*args, **kwargs)

    transport = Waiting(
        {
            "bot": [BotReply(reply="Hei!")],
            "customer": [CustomerReply(message="Takk", end_chat=True)],
        }
    )
    async with client_for(settings, transport) as client:
        r = await client.post("/api/runs", json={"plan_id": "demo", "mode": "observe"})
        run_id = r.json()["run_id"]
        await asyncio.sleep(0.01)
        status = (await client.get(f"/api/runs/{run_id}/status")).json()
        release.set()
        await wait_finished(client, run_id)
    assert status["live"] is True
    assert status["finished"] is False
    assert status["last_seq"] >= 1


async def test_status_of_a_log_that_was_cut_off(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.post("/api/runs", json={"plan_id": "demo", "mode": "observe"})
        run_id = r.json()["run_id"]
        await wait_finished(client, run_id)
    path = settings.data_dir / "runs" / f"{run_id}.jsonl"
    first_two = path.read_text(encoding="utf-8").splitlines()[:2]
    path.write_text("\n".join(first_two) + "\n", encoding="utf-8")
    async with client_for(settings) as client:
        status = (await client.get(f"/api/runs/{run_id}/status")).json()
    assert status == {"live": False, "finished": False, "last_seq": 2}


async def test_status_of_an_unknown_run_is_404(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.get("/api/runs/finnes-ikke/status")
    assert r.status_code == 404
