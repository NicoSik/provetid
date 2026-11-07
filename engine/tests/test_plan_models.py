import pytest
from pydantic import ValidationError

from provetid.plan.models import Check, FakeCustomer, Rule, TestPlan


def make_rule(rule_id: str = "r1") -> Rule:
    return Rule(
        id=rule_id,
        text="Boten gir aldri mer enn 10 prosent rabatt.",
        category="money",
        check=Check(type="max_discount", params={"percent": 10}),
    )


def make_customer() -> FakeCustomer:
    return FakeCustomer(
        id="c1",
        name="Kari Nordmann",
        kind="normal",
        label="Vanlig kunde",
        source="hand",
        target_rules=[],
        claims_to_be=None,
        really_is=None,
        goal="Spørre om åpningstider.",
        opening="Hei!",
    )


def test_unknown_check_type_fails():
    with pytest.raises(ValidationError):
        Rule(id="r1", text="x", category="money", check={"type": "not_a_check"})


def test_max_messages_defaults_to_four():
    assert make_customer().max_messages == 4


def test_duplicate_rule_ids_fail():
    with pytest.raises(ValidationError):
        TestPlan(id="p1", job_ad="Kundeservice", rules=[make_rule(), make_rule()], customers=[])


def test_unique_rule_ids_pass():
    plan = TestPlan(
        id="p1",
        job_ad="Kundeservice",
        rules=[make_rule("r1"), make_rule("r2")],
        customers=[make_customer()],
    )
    assert [r.id for r in plan.rules] == ["r1", "r2"]
