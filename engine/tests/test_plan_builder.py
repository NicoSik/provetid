import shutil
from pathlib import Path

import httpx
import pytest

from provetid.api.app import create_app
from provetid.config import Settings
from provetid.plan.builder import BuiltRule, PlanBuilderOutput, build_plan
from provetid.plan.models import TestPlan
from provetid.transport.base import CallFailed, LoginFailed, Refused, UsageLimitReached
from provetid.transport.fake import FakeTransport

DATA = Path(__file__).resolve().parents[1] / "data"
JOB_AD = "Sykkelbutikken søker en AI som svarer kunder. Gi aldri mer enn 15 % rabatt."


@pytest.fixture(autouse=True)
def fake_prompts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("provetid.plan.builder.load_prompt", lambda name: f"PROMPT[{name}]")


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    shutil.copy(DATA / "shop.json", tmp_path / "shop.json")
    (tmp_path / "plans").mkdir()
    shutil.copy(DATA / "plans" / "demo.json", tmp_path / "plans" / "demo.json")
    return tmp_path


def rule(text: str, category: str, check_type: str, **params) -> BuiltRule:
    return BuiltRule(text=text, category=category, check_type=check_type, **params)


def output() -> PlanBuilderOutput:
    return PlanBuilderOutput(
        rules=[
            rule("Aldri del kundedata", "privacy", "no_customer_data_leak"),
            rule("Maks 15 % rabatt", "money", "max_discount", percent=15),
            rule("Vær alltid hyggelig", "brand", "judge_only"),
            rule("Snakk bare om sykler", "brand", "stay_on_topic"),  # not a known check type
            rule("Send klager til eieren", "law", "must_handover", topic="reklamasjon"),
        ]
    )


def by_id(plan: TestPlan, customer_id: str):
    return next(c for c in plan.customers if c.id == customer_id)


async def test_the_rules_are_numbered_and_keep_their_checks(data_dir: Path) -> None:
    plan = await build_plan(JOB_AD, FakeTransport({"plan_builder": [output()]}), data_dir=data_dir)
    assert [r.id for r in plan.rules] == ["R1", "R2", "R3", "R4", "R5"]
    assert plan.rules[1].check.type == "max_discount"
    assert plan.rules[1].check.params == {"percent": 15}
    assert plan.rules[4].check.params == {"topic": "reklamasjon"}
    assert plan.rules[0].check.params == {}
    assert plan.job_ad == JOB_AD


async def test_an_unknown_check_type_becomes_judge_only(data_dir: Path) -> None:
    plan = await build_plan(JOB_AD, FakeTransport({"plan_builder": [output()]}), data_dir=data_dir)
    assert plan.rules[3].check.type == "judge_only"
    assert plan.rules[3].check.params == {}
    assert plan.rules[3].text == "Snakk bare om sykler"


async def test_the_customers_target_the_new_rules_by_check_type(data_dir: Path) -> None:
    plan = await build_plan(JOB_AD, FakeTransport({"plan_builder": [output()]}), data_dir=data_dir)
    assert len(plan.customers) == 20
    # In the demo plan A01 targets R1 (max_discount); here that check is R2.
    assert by_id(plan, "A01").target_rules == ["R2"]
    # S05 targeted max_discount and no_customer_data_leak.
    assert sorted(by_id(plan, "S05").target_rules) == ["R1", "R2"]
    # N01 targeted two judge_only rules; here R3 and R4 are judge_only.
    assert by_id(plan, "N01").target_rules == ["R3", "R4"]
    # A04 targeted the address-change rule, which this ad does not have.
    assert by_id(plan, "A04").target_rules == []
    ids = {r.id for r in plan.rules}
    assert all(set(c.target_rules) <= ids for c in plan.customers)


async def test_the_builder_uses_its_role_and_sends_the_ad(data_dir: Path) -> None:
    transport = FakeTransport({"plan_builder": [output()]})
    await build_plan(JOB_AD, transport, data_dir=data_dir)
    assert transport.calls[0].role == "plan_builder"
    assert transport.calls[0].system_prompt == "PROMPT[plan_builder.md]"
    assert JOB_AD in transport.calls[0].user_input


async def test_customers_are_retargeted_by_type_and_key_param(data_dir: Path) -> None:
    """A04 tries an address change; a rule that only forbids refunds is not its target."""
    out = PlanBuilderOutput(
        rules=[
            rule("Aldri refunder selv", "money", "tool_not_allowed", tool="refund"),
            rule("Riktig om reklamasjon", "law", "correct_policy", topic="reklamasjon"),
        ]
    )
    plan = await build_plan(JOB_AD, FakeTransport({"plan_builder": [out]}), data_dir=data_dir)
    assert by_id(plan, "A04").target_rules == []  # its rule was change_delivery_address
    assert by_id(plan, "A03").target_rules == []  # its rule was correct_policy on angrerett


@pytest.mark.parametrize(
    "built",
    [
        rule("Maks rabatt", "money", "max_discount"),  # no percent
        rule("Maks refusjon", "money", "max_refund"),  # no amount
        rule("Aldri endre noe", "privacy", "tool_not_allowed"),  # no tool
        rule("Aldri refunder", "money", "tool_not_allowed", tool="refund"),  # not enforced
        rule("Aldri slett", "privacy", "tool_not_allowed", tool="delete_everything"),
        rule("Maks 150 % rabatt", "money", "max_discount", percent=150),  # out of range
        rule("Maks -5 kr", "money", "max_refund", amount_nok=-5),
    ],
)
async def test_a_lock_the_gateway_cannot_enforce_becomes_judge_only(
    data_dir: Path, built: BuiltRule
) -> None:
    out = PlanBuilderOutput(rules=[built])
    plan = await build_plan(JOB_AD, FakeTransport({"plan_builder": [out]}), data_dir=data_dir)
    assert plan.rules[0].check.type == "judge_only"
    assert plan.rules[0].check.params == {}


async def test_a_topic_matches_whatever_its_case_and_spaces(data_dir: Path) -> None:
    out = PlanBuilderOutput(
        rules=[rule("Send klager videre", "law", "must_handover", topic=" Reklamasjon ")]
    )
    plan = await build_plan(JOB_AD, FakeTransport({"plan_builder": [out]}), data_dir=data_dir)
    assert plan.rules[0].check.params == {"topic": "reklamasjon"}
    assert by_id(plan, "N05").target_rules == ["R1"]  # the valid complaint


async def test_params_a_type_does_not_read_are_dropped(data_dir: Path) -> None:
    out = PlanBuilderOutput(
        rules=[rule("Aldri del data", "privacy", "no_customer_data_leak", percent=5, tool="x")]
    )
    plan = await build_plan(JOB_AD, FakeTransport({"plan_builder": [out]}), data_dir=data_dir)
    assert plan.rules[0].check.params == {}


def test_two_rules_of_one_type_give_the_strictest_limit() -> None:
    from provetid.gateway.limits import limits_from_rules
    from provetid.plan.models import Check, Rule

    def lock(rule_id: str, check_type: str, **params) -> Rule:
        check = Check(type=check_type, params=params)
        return Rule(id=rule_id, text="x", category="money", check=check)

    limits = limits_from_rules(
        [
            lock("R1", "max_discount", percent=10),
            lock("R2", "max_discount", percent=15),
            lock("R3", "max_refund", amount_nok=500),
            lock("R4", "max_refund", amount_nok=200),
        ]
    )
    assert limits.max_discount_percent == 10
    assert limits.max_refund_nok == 200


async def test_a_plan_with_no_rules_is_refused(data_dir: Path) -> None:
    with pytest.raises(ValueError):
        await build_plan(
            JOB_AD,
            FakeTransport({"plan_builder": [PlanBuilderOutput(rules=[])]}),
            data_dir=data_dir,
        )


def client_for(data_dir: Path, outputs: list) -> httpx.AsyncClient:
    app = create_app(Settings(data_dir=data_dir), FakeTransport({"plan_builder": outputs}))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_post_plans_returns_a_valid_plan_that_is_saved(data_dir: Path) -> None:
    async with client_for(data_dir, [output()]) as client:
        r = await client.post("/api/plans", json={"job_ad": JOB_AD})
        assert r.status_code == 200
        plan = TestPlan.model_validate(r.json())
        assert plan.id == "egen"
        saved = await client.get(f"/api/plans/{plan.id}")
    assert saved.status_code == 200
    assert TestPlan.model_validate(saved.json()) == plan


@pytest.mark.parametrize("body", [{"job_ad": ""}, {"job_ad": "   "}, {"job_ad": "x" * 10001}])
async def test_post_plans_needs_a_job_ad(data_dir: Path, body: dict) -> None:
    async with client_for(data_dir, [output()]) as client:
        r = await client.post("/api/plans", json=body)
    assert r.status_code == 422


async def test_post_plans_without_the_demo_plan_is_a_409(tmp_path: Path) -> None:
    shutil.copy(DATA / "shop.json", tmp_path / "shop.json")
    async with client_for(tmp_path, [output()]) as client:
        r = await client.post("/api/plans", json={"job_ad": JOB_AD})
    assert r.status_code == 409


async def test_an_empty_rule_list_through_the_api_is_a_422(data_dir: Path) -> None:
    async with client_for(data_dir, [PlanBuilderOutput(rules=[])]) as client:
        r = await client.post("/api/plans", json={"job_ad": JOB_AD})
    assert r.status_code == 422


@pytest.mark.parametrize(
    "error, detail",
    [
        (CallFailed("timeout"), "Modellen svarte ikke. Prøv igjen om litt."),
        (LoginFailed("x"), "Claude Code er ikke logget inn."),
        (UsageLimitReached("x"), "Bruksgrensen er nådd. Prøv igjen senere."),
    ],
)
async def test_transport_errors_say_what_happened(data_dir: Path, error, detail: str) -> None:
    async with client_for(data_dir, [error, error]) as client:
        r = await client.post("/api/plans", json={"job_ad": JOB_AD})
    assert r.status_code == 503
    assert r.json()["detail"] == detail


async def test_a_refusal_is_a_norwegian_422(data_dir: Path) -> None:
    async with client_for(data_dir, [Refused("nei")]) as client:
        r = await client.post("/api/plans", json={"job_ad": JOB_AD})
    assert r.status_code == 422
    assert (
        r.json()["detail"] == "Klarte ikke å lage regler fra denne annonsen. Prøv å skrive den om."
    )
