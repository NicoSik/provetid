import shutil
from pathlib import Path

import httpx
import pytest

from provetid.api.app import create_app
from provetid.config import Settings
from provetid.transport.fake import FakeTransport

DEMO = Path(__file__).resolve().parents[1] / "data" / "plans" / "demo.json"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    (tmp_path / "plans").mkdir()
    shutil.copy(DEMO, tmp_path / "plans" / "demo.json")
    return Settings(data_dir=tmp_path)


def client_for(settings: Settings) -> httpx.AsyncClient:
    app = create_app(settings, FakeTransport({}))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_get_returns_the_demo_plan(settings: Settings) -> None:
    async with client_for(settings) as client:
        got = await client.get("/api/plans/demo")
    assert got.status_code == 200
    assert got.json()["id"] == "demo"
    assert len(got.json()["rules"]) == 9
    assert len(got.json()["customers"]) == 20


async def test_get_of_an_unknown_plan_is_404(settings: Settings) -> None:
    async with client_for(settings) as client:
        assert (await client.get("/api/plans/nope")).status_code == 404
        assert (await client.get("/api/plans/..%2Fx")).status_code == 404


async def test_a_put_with_an_edited_rule_text_persists(settings: Settings) -> None:
    async with client_for(settings) as client:
        plan = (await client.get("/api/plans/demo")).json()
        plan["rules"][0]["text"] = "Maks 5 % rabatt"
        put = await client.put("/api/plans/demo", json=plan)
        got = await client.get("/api/plans/demo")
    assert put.status_code == 200
    assert got.json()["rules"][0]["text"] == "Maks 5 % rabatt"
    assert "Maks 5 % rabatt" in (settings.data_dir / "plans" / "demo.json").read_text("utf-8")


async def test_a_put_with_an_unknown_check_type_is_422(settings: Settings) -> None:
    async with client_for(settings) as client:
        plan = (await client.get("/api/plans/demo")).json()
        plan["rules"][0]["check"]["type"] = "max_vibes"
        put = await client.put("/api/plans/demo", json=plan)
        got = await client.get("/api/plans/demo")
    assert put.status_code == 422
    assert got.json()["rules"][0]["check"]["type"] == "max_discount"


async def test_a_put_whose_id_differs_from_the_path_is_422(settings: Settings) -> None:
    async with client_for(settings) as client:
        plan = (await client.get("/api/plans/demo")).json()
        plan["id"] = "other"
        assert (await client.put("/api/plans/demo", json=plan)).status_code == 422
