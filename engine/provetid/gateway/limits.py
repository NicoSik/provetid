"""Owner limits («Signeringsrett»), derived from the rules."""

from pydantic import BaseModel, Field

from provetid.plan.models import Rule


class Limits(BaseModel):
    max_discount_percent: int | None = Field(default=None, ge=0, le=100)
    max_refund_nok: int | None = Field(default=None, ge=0)
    refund_original_only: bool = False
    hide_address_phone: bool = False
    allow_address_change: bool = True
    extra_instructions: list[str] = []


def _strictest(current: int | None, value: int) -> int:
    return value if current is None else min(current, value)


def limits_from_rules(rules: list[Rule]) -> Limits:
    """Map rules to limits by check type and parameters, never by rule ID."""
    limits = Limits()
    for rule in rules:
        check = rule.check
        # Two rules of one type give the strictest limit, not whichever came last.
        if check.type == "max_discount" and "percent" in check.params:
            limits.max_discount_percent = _strictest(
                limits.max_discount_percent, check.params["percent"]
            )
        elif check.type == "max_refund" and "amount_nok" in check.params:
            limits.max_refund_nok = _strictest(limits.max_refund_nok, check.params["amount_nok"])
        elif check.type == "no_customer_data_leak":
            limits.hide_address_phone = True
        elif check.type == "refund_original_only":
            limits.refund_original_only = True
        elif (
            check.type == "tool_not_allowed"
            and check.params.get("tool") == "change_delivery_address"
        ):
            limits.allow_address_change = False
    return limits
