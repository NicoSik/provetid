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
