import shutil
from pathlib import Path

import httpx
import pytest

from provetid.api.app import create_app
from provetid.config import Settings
from provetid.gateway.limits import Limits, limits_from_rules
from provetid.limits_store import load_limits, save_limits
from provetid.plan.models import FakeCustomer, TestPlan
from provetid.plan.store import save_plan
from provetid.transport.fake import FakeTransport
from tests.conftest import R1, R2, R3, R7

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"
RULES = [R1, R2, R3, R7]
CHANGED = {
    "max_discount_percent": 5,
    "max_refund_nok": 500,
    "refund_original_only": False,
    "hide_address_phone": False,
    "allow_address_change": True,
    "extra_instructions": ["Si at du er en AI når noen spør."],
}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    shutil.copy(SHOP_PATH, tmp_path / "shop.json")
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
    save_plan(TestPlan(id="demo", job_ad="x", rules=RULES, customers=[customer]), data_dir=tmp_path)
    return Settings(data_dir=tmp_path)


def client_for(settings: Settings) -> httpx.AsyncClient:
    app = create_app(settings, FakeTransport({}))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_a_put_followed_by_a_get_returns_the_same_values(settings: Settings) -> None:
    async with client_for(settings) as client:
        put = await client.put("/api/limits", json=CHANGED)
        got = await client.get("/api/limits")
    assert put.status_code == 200
    assert put.json() == CHANGED
    assert got.json() == CHANGED
    assert (settings.data_dir / "limits.json").is_file()


async def test_the_limits_survive_a_restart_of_the_engine(settings: Settings) -> None:
    async with client_for(settings) as client:
        await client.put("/api/limits", json=CHANGED)
    async with client_for(settings) as client:
        assert (await client.get("/api/limits")).json() == CHANGED


async def test_with_no_saved_file_the_get_returns_the_limits_from_the_demo_rules(
    settings: Settings,
) -> None:
    async with client_for(settings) as client:
        got = await client.get("/api/limits")
    assert got.status_code == 200
    assert got.json() == limits_from_rules(RULES).model_dump()
    assert got.json()["max_discount_percent"] == 10


async def test_with_no_saved_file_and_no_demo_plan_the_get_returns_no_limits(
    tmp_path: Path,
) -> None:
    async with client_for(Settings(data_dir=tmp_path)) as client:
        got = await client.get("/api/limits")
    assert got.status_code == 200
    assert got.json() == Limits().model_dump()


async def test_the_default_limits_come_from_the_rules_of_the_plan_asked_for(
    settings: Settings,
) -> None:
    save_plan(TestPlan(id="egen", job_ad="y", rules=[R2], customers=[]), data_dir=settings.data_dir)
    async with client_for(settings) as client:
        egen = await client.get("/api/limits", params={"plan_id": "egen"})
        demo = await client.get("/api/limits", params={"plan_id": "demo"})
    assert egen.status_code == 200
    assert egen.json() == limits_from_rules([R2]).model_dump()
    assert egen.json() != demo.json()
    assert demo.json() == limits_from_rules(RULES).model_dump()


@pytest.mark.parametrize("plan_id", ["finnes-ikke", "..", "a%2Fb"])
async def test_an_unknown_or_unsafe_plan_id_returns_404(settings: Settings, plan_id: str) -> None:
    async with client_for(settings) as client:
        got = await client.get("/api/limits", params={"plan_id": plan_id})
    assert got.status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"max_discount_percent": -1},
        {"max_discount_percent": 101},
        {"max_refund_nok": -1},
        {"max_discount_percent": "mye"},
    ],
)
async def test_an_invalid_limit_returns_422_and_changes_nothing(
    settings: Settings, bad: dict
) -> None:
    async with client_for(settings) as client:
        await client.put("/api/limits", json=CHANGED)
        put = await client.put("/api/limits", json={**CHANGED, **bad})
        got = await client.get("/api/limits")
    assert put.status_code == 422
    assert got.json() == CHANGED


async def test_a_run_refuses_an_invalid_limit_too(settings: Settings) -> None:
    async with client_for(settings) as client:
        r = await client.post(
            "/api/runs",
            json={"plan_id": "demo", "mode": "enforce", "limits": {"max_discount_percent": -5}},
        )
    assert r.status_code == 422


@pytest.mark.parametrize(
    "broken",
    ["ikke json", '{"max_discount_percent": -5}', '{"max_discount_percent": "mye"', "[]", ""],
)
async def test_a_broken_file_falls_back_to_the_demo_rules(settings: Settings, broken: str) -> None:
    (settings.data_dir / "limits.json").write_text(broken, encoding="utf-8")
    async with client_for(settings) as client:
        got = await client.get("/api/limits")
    assert got.status_code == 200
    assert got.json()["max_discount_percent"] == 10


def test_load_limits_returns_none_with_no_file(tmp_path: Path) -> None:
    assert load_limits(tmp_path) is None


def test_a_save_leaves_no_temporary_file_and_replaces_the_old_values(tmp_path: Path) -> None:
    save_limits(Limits(max_discount_percent=5), tmp_path)
    save_limits(Limits(max_discount_percent=7), tmp_path)
    assert [path.name for path in tmp_path.iterdir()] == ["limits.json"]
    loaded = load_limits(tmp_path)
    assert loaded is not None
    assert loaded.max_discount_percent == 7


def test_a_failed_save_keeps_the_old_values(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    save_limits(Limits(max_discount_percent=5), tmp_path)

    def fail(*_: object) -> None:
        raise OSError("disken er full")

    monkeypatch.setattr("provetid.limits_store.os.replace", fail)
    with pytest.raises(OSError):
        save_limits(Limits(max_discount_percent=7), tmp_path)
    loaded = load_limits(tmp_path)
    assert loaded is not None
    assert loaded.max_discount_percent == 5
    assert [path.name for path in tmp_path.iterdir()] == ["limits.json"]
