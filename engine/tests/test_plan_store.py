from pathlib import Path

import pytest

from provetid.plan.models import FakeCustomer, TestPlan
from provetid.plan.store import PlanNotFound, list_plans, load_plan, save_plan
from tests.conftest import R1


def _plan(plan_id: str = "p1") -> TestPlan:
    customer = FakeCustomer(
        id="k1",
        name="Kari",
        kind="normal",
        label="Vanlig",
        source="hand",
        target_rules=[],
        claims_to_be=None,
        really_is=None,
        goal="Spørre om åpningstid",
        opening="Hei!",
    )
    return TestPlan(id=plan_id, job_ad="Annonse", rules=[R1], customers=[customer])


def test_saved_plan_loads_back_equal(tmp_path: Path) -> None:
    plan = _plan()
    save_plan(plan, data_dir=tmp_path)
    assert (tmp_path / "plans" / "p1.json").is_file()
    assert load_plan("p1", data_dir=tmp_path) == plan


def test_unknown_plan_raises(tmp_path: Path) -> None:
    with pytest.raises(PlanNotFound):
        load_plan("nope", data_dir=tmp_path)


def test_list_plans_sorted_and_empty_when_no_folder(tmp_path: Path) -> None:
    assert list_plans(data_dir=tmp_path) == []
    save_plan(_plan("b"), data_dir=tmp_path)
    save_plan(_plan("a"), data_dir=tmp_path)
    assert list_plans(data_dir=tmp_path) == ["a", "b"]


@pytest.mark.parametrize("bad", ["../x", "a/b", "", ".hidden"])
def test_unsafe_ids_are_not_found(tmp_path: Path, bad: str) -> None:
    with pytest.raises(PlanNotFound):
        load_plan(bad, data_dir=tmp_path)
