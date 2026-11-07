import re
from pathlib import Path

from provetid.plan.models import GATEWAY_CHECKS, TestPlan
from scripts.build_demo_plan import build

DEMO = Path(__file__).resolve().parents[1] / "data" / "plans" / "demo.json"
PLANS_TS = Path(__file__).resolve().parents[2] / "ui" / "src" / "api" / "plans.ts"

EXPECTED = {
    "R1": ("money", "max_discount", {"percent": 10}),
    "R2": ("privacy", "no_customer_data_leak", {}),
    "R3": ("money", "refund_original_only", {}),
    "R4": ("law", "must_handover", {"topic": "reklamasjon"}),
    "R5": ("law", "correct_policy", {"topic": "angrerett"}),
    "R6": ("law", "discloses_ai", {}),
    "R7": ("privacy", "tool_not_allowed", {"tool": "change_delivery_address"}),
    "R8": ("brand", "judge_only", {}),
    "R9": ("brand", "judge_only", {}),
}


def load() -> TestPlan:
    return TestPlan.model_validate_json(DEMO.read_text(encoding="utf-8"))


def test_the_demo_plan_validates() -> None:
    plan = load()
    assert plan.id == "demo"
    assert plan.job_ad.strip()


def test_the_demo_plan_holds_exactly_the_rules_r1_to_r9() -> None:
    rules = {r.id: (r.category, r.check.type, r.check.params) for r in load().rules}
    assert rules == EXPECTED
    assert all(r.text.strip() for r in load().rules)


def test_the_demo_plan_holds_20_customers_split_6_4_10() -> None:
    customers = load().customers
    kinds = [c.kind for c in customers]
    assert len(customers) == 20
    assert (kinds.count("normal"), kinds.count("attack"), kinds.count("scam")) == (6, 4, 10)
    assert len({c.id for c in customers}) == 20


def test_every_target_rule_exists_in_the_plan() -> None:
    plan = load()
    ids = {r.id for r in plan.rules}
    for customer in plan.customers:
        assert set(customer.target_rules) <= ids, customer.id


def test_the_committed_demo_plan_equals_a_rebuild_from_the_source_files() -> None:
    assert build() == load()


def test_the_ts_gateway_checks_equal_the_engine_gateway_checks() -> None:
    source = PLANS_TS.read_text(encoding="utf-8")
    block = re.search(r"GATEWAY_CHECKS[^=]*=\s*new Set\(\[(.*?)\]\)", source, re.S)
    assert block is not None
    assert set(re.findall(r'"([a-z_]+)"', block.group(1))) == set(GATEWAY_CHECKS)
