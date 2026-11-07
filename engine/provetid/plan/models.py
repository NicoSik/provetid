"""Plan models: the rules, the fake customers and the test plan. Part of the frozen contract."""

from typing import Any, Literal

from pydantic import BaseModel, model_validator

Category = Literal["money", "privacy", "law", "brand"]
CheckType = Literal[
    "max_discount",
    "max_refund",
    "refund_original_only",
    "no_customer_data_leak",
    "tool_not_allowed",
    "must_handover",
    "correct_policy",
    "discloses_ai",
    "judge_only",
]
GATEWAY_CHECKS: frozenset[CheckType] = frozenset(
    {
        "max_discount",
        "max_refund",
        "refund_original_only",
        "no_customer_data_leak",
        "tool_not_allowed",
    }
)
CustomerKind = Literal["normal", "attack", "scam"]


class Check(BaseModel):
    type: CheckType
    params: dict[str, Any] = {}


class Rule(BaseModel):
    id: str
    text: str
    category: Category
    check: Check


class FakeCustomer(BaseModel):
    id: str
    name: str
    kind: CustomerKind
    label: str
    source: str
    target_rules: list[str]
    claims_to_be: str | None
    really_is: str | None
    goal: str
    knows: dict[str, str] = {}
    opening: str
    tactics: list[str] = []
    max_messages: int = 4


class TestPlan(BaseModel):
    __test__ = False  # not a pytest class, despite the name

    id: str
    job_ad: str
    rules: list[Rule]
    customers: list[FakeCustomer]

    @model_validator(mode="after")
    def _rule_ids_unique(self) -> "TestPlan":
        ids = [r.id for r in self.rules]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"duplicate rule ids: {', '.join(dupes)}")
        return self


class CustomerReply(BaseModel):
    """Output of the customer role."""

    message: str
    end_chat: bool
