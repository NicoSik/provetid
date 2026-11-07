import asyncio
import json
import shutil
from pathlib import Path

import httpx
import pytest

from provetid.api.app import create_app
from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import MessageData, RunFinishedData
from provetid.transport.fake import FakeTransport

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"


@pytest.fixture
def finished_run(tmp_path: Path) -> tuple[Settings, str]:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    log = EventLog("old-run", tmp_path / "runs" / "old-run.jsonl")
    for i in range(5):
        log.append("message", MessageData(role="customer", text=f"m{i}", index=i), "chat-1")
    log.append("run_finished", RunFinishedData(totals={}))
    return Settings(data_dir=tmp_path), "old-run"


def seqs(text: str) -> list[int]:
    return [
        json.loads(line.removeprefix("data: "))["seq"]
        for line in text.splitlines()
        if line.startswith("data: ")
    ]


async def get(settings: Settings, url: str, headers: dict | None = None) -> str:
    app = create_app(settings, FakeTransport({}))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        return (await client.get(url, headers=headers)).text


async def test_last_event_id_resumes_without_gap(finished_run: tuple[Settings, str]) -> None:
    settings, run_id = finished_run
    text = await get(settings, f"/api/runs/{run_id}/events", {"Last-Event-ID": "3"})
    assert seqs(text) == [4, 5, 6]


async def test_after_query_resumes_too(finished_run: tuple[Settings, str]) -> None:
    settings, run_id = finished_run
    text = await get(settings, f"/api/runs/{run_id}/events?after=4")
    assert seqs(text) == [5, 6]


async def test_garbage_last_event_id_replays_everything(
    finished_run: tuple[Settings, str],
) -> None:
    settings, run_id = finished_run
    text = await get(settings, f"/api/runs/{run_id}/events", {"Last-Event-ID": "x"})
    assert seqs(text) == [1, 2, 3, 4, 5, 6]


async def test_unfinished_run_from_disk_replays_and_ends(tmp_path: Path) -> None:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    log = EventLog("cut", tmp_path / "runs" / "cut.jsonl")
    log.append("message", MessageData(role="bot", text="a", index=0), "chat-1")
    text = await get(Settings(data_dir=tmp_path), "/api/runs/cut/events")
    assert seqs(text) == [1]


async def test_a_broken_log_does_not_hide_the_other_runs(tmp_path: Path) -> None:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    good = EventLog("good", tmp_path / "runs" / "good.jsonl")
    good.append("run_finished", RunFinishedData(totals={}))
    broken = EventLog("broken", tmp_path / "runs" / "broken.jsonl")
    broken.append("message", MessageData(role="bot", text="a", index=0), "chat-1")
    broken.append("message", MessageData(role="bot", text="b", index=1), "chat-1")
    lines = broken.path.read_text(encoding="utf-8").splitlines()
    broken.path.write_text("ikke json\n" + lines[1] + "\n", encoding="utf-8")

    app = create_app(Settings(data_dir=tmp_path), FakeTransport({}))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        r = await client.get("/api/runs")

    assert r.status_code == 200
    assert [row["run_id"] for row in r.json()] == ["good"]


def live_app(tmp_path: Path, log: EventLog):
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    app = create_app(Settings(data_dir=tmp_path), FakeTransport({}))
    app.state.live_logs[log.run_id] = log
    return app


async def feed(log: EventLog, texts: list[str], pause: float) -> None:
    """Wait for a subscriber, then append messages with a pause before each, then finish."""
    while log.waiter_count == 0:
        await asyncio.sleep(0.001)
    for i, text in enumerate(texts):
        await asyncio.sleep(pause)
        log.append("message", MessageData(role="bot", text=text, index=i), "chat-1")
    await asyncio.sleep(pause)
    log.append("run_finished", RunFinishedData(totals={}))


async def test_last_event_id_resumes_a_live_run_without_gap_or_duplicate(tmp_path: Path) -> None:
    log = EventLog("live", tmp_path / "runs" / "live.jsonl")
    for i in range(3):
        log.append("message", MessageData(role="customer", text=f"m{i}", index=i), "chat-1")
    app = live_app(tmp_path, log)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        feeding = asyncio.create_task(feed(log, ["n1", "n2"], pause=0.02))
        r = await client.get("/api/runs/live/events", headers={"Last-Event-ID": "2"})
        await feeding

    assert seqs(r.text) == [3, 4, 5, 6]


async def test_an_idle_live_stream_sends_a_ping(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("provetid.api.routes.runs.HEARTBEAT_S", 0.01)
    log = EventLog("live", tmp_path / "runs" / "live.jsonl")
    app = live_app(tmp_path, log)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        feeding = asyncio.create_task(feed(log, ["n1"], pause=0.05))
        r = await client.get("/api/runs/live/events")
        await feeding

    assert ": ping\n\n" in r.text
    assert seqs(r.text) == [1, 2]
    # A ping never splits an event: every frame is a comment or a whole event.
    for frame in r.text.split("\n\n"):
        assert frame == "" or frame == ": ping" or frame.startswith("id: ")


async def test_a_replay_from_disk_sends_no_ping(
    finished_run: tuple[Settings, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("provetid.api.routes.runs.HEARTBEAT_S", 0.0001)
    settings, run_id = finished_run
    text = await get(settings, f"/api/runs/{run_id}/events")
    assert ": ping" not in text


async def test_a_closed_heartbeat_stream_leaves_no_waiter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from provetid.api.routes.runs import _with_heartbeat

    monkeypatch.setattr("provetid.api.routes.runs.HEARTBEAT_S", 0.01)
    log = EventLog("live", tmp_path / "live.jsonl")
    stream = _with_heartbeat(log.subscribe())
    assert await anext(stream) is None  # a ping while the run is idle
    assert log.waiter_count == 1
    await stream.aclose()  # the browser went away
    assert log.waiter_count == 0


@pytest.mark.parametrize("path", ["", "/status", "/events"])
async def test_a_broken_log_is_a_clean_error(tmp_path: Path, path: str) -> None:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
    log = EventLog("broken", tmp_path / "runs" / "broken.jsonl")
    log.append("message", MessageData(role="bot", text="a", index=0), "chat-1")
    log.append("message", MessageData(role="bot", text="b", index=1), "chat-1")
    lines = log.path.read_text(encoding="utf-8").splitlines()
    log.path.write_text("ikke json\n" + lines[1] + "\n", encoding="utf-8")

    app = create_app(Settings(data_dir=tmp_path), FakeTransport({}))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        r = await client.get(f"/api/runs/broken{path}")

    assert r.status_code == 422
    assert r.json()["detail"] == "Kjøringen er skadet."
