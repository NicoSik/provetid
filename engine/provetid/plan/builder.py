"""Turn any job ad into a test plan with the plan_builder role (REQ-1.11).

The model writes the rules. The customers come from the demo plan's library: each customer's
target rules are mapped to the new rule IDs through their check type, and for tool and topic
checks also what they are about. So the discount hunter targets whichever new rule has
`max_discount`, and the address-change attacker only a rule that forbids address changes.
"""

from pathlib import Path
from typing import cast, get_args

from pydantic import BaseModel

from provetid.config import DEFAULT_DATA_DIR
from provetid.plan.models import Category, Check, CheckType, FakeCustomer, Rule, TestPlan
from provetid.plan.store import load_plan
from provetid.runner.prompts import load_prompt
from provetid.transport.base import Transport

LIBRARY_PLAN = "demo"  # the plan whose customers serve as the library
CHECK_TYPES: frozenset[str] = frozenset(get_args(CheckType))
# The param each check type needs, and the field of BuiltRule that holds it. A rule that lacks it
# cannot be checked, so it becomes judge_only.
PARAMS: dict[str, str] = {
    "max_discount": "percent",
    "max_refund": "amount_nok",
    "tool_not_allowed": "tool",
    "must_handover": "topic",
    "correct_policy": "topic",
}
# The params that say *what* a check is about. Customers are matched on these too, so an
# attacker who tries an address change never counts as testing a rule against refunds.
IDENTITY = {"tool_not_allowed", "must_handover", "correct_policy"}
# The only tool the gateway blocks by itself (gateway/limits.py). Any other forbidden tool would
# show as «Lås» but only ever be flagged, so it is left to the judge.
ENFORCED_TOOLS = {"change_delivery_address"}


class BuiltRule(BaseModel):
    text: str
    category: Category
    check_type: str  # a free string, so an unknown type can become judge_only
    percent: int | None = None
    amount_nok: int | None = None
    tool: str | None = None
    topic: str | None = None


class PlanBuilderOutput(BaseModel):
    rules: list[BuiltRule]


def _check(built: BuiltRule) -> Check:
    """The check for a built rule, or judge_only when it is unknown or cannot be checked."""
    if built.check_type not in CHECK_TYPES:
        return Check(type="judge_only")
    field = PARAMS.get(built.check_type)
    if field is None:
        return Check(type=cast(CheckType, built.check_type))
    value = getattr(built, field)
    if isinstance(value, str):
        value = value.strip().lower()  # «Reklamasjon» and «reklamasjon» are the same topic
    if (
        value is None
        or value == ""
        or (field == "tool" and value not in ENFORCED_TOOLS)
        or (field == "percent" and not 0 <= value <= 100)
        or (field == "amount_nok" and value < 0)
    ):
        return Check(type="judge_only")
    return Check(type=cast(CheckType, built.check_type), params={field: value})


def _rule(index: int, built: BuiltRule) -> Rule:
    return Rule(id=f"R{index}", text=built.text, category=built.category, check=_check(built))


def _identity(rule: Rule) -> tuple[str, object]:
    field = PARAMS.get(rule.check.type)
    key = rule.check.params.get(field) if rule.check.type in IDENTITY and field else None
    return (rule.check.type, key)


def _retarget(customer: FakeCustomer, old: dict[str, Rule], new: list[Rule]) -> FakeCustomer:
    """Point a library customer at the new rules that test the same thing as its old ones."""
    wanted = {_identity(old[rule_id]) for rule_id in customer.target_rules if rule_id in old}
    targets = [rule.id for rule in new if _identity(rule) in wanted]
    return customer.model_copy(update={"target_rules": targets})


async def build_plan(
    job_ad: str,
    transport: Transport,
    *,
    data_dir: Path = DEFAULT_DATA_DIR,
    plan_id: str = "egen",
) -> TestPlan:
    """Raises `PlanNotFound` without the library plan, and ValueError if no rules came back."""
    library = load_plan(LIBRARY_PLAN, data_dir=data_dir)
    result = await transport.call(
        "plan_builder", load_prompt("plan_builder.md"), job_ad, PlanBuilderOutput
    )
    out = result.data
    assert isinstance(out, PlanBuilderOutput)
    if not out.rules:
        raise ValueError("the plan builder returned no rules")
    rules = [_rule(index, built) for index, built in enumerate(out.rules, start=1)]
    old = {rule.id: rule for rule in library.rules}
    customers = [_retarget(customer, old, rules) for customer in library.customers]
    return TestPlan(id=plan_id, job_ad=job_ad, rules=rules, customers=customers)
