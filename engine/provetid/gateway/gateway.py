"""The gateway: every bot action passes here before it changes the chat's shop copy."""

from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from provetid.events import Mode
from provetid.gateway.actions import ARG_MODELS, Action
from provetid.gateway.limits import Limits
from provetid.gateway.tools import run_tool
from provetid.plan.models import Rule
from provetid.shop.data import ShopState
from provetid.shop.leaks import LeakHit, find_leaks


class GatewayDecision(BaseModel):
    decision: Literal["allowed", "flagged", "blocked"]
    rule_id: str | None
    result: dict[str, Any] | str
    result_summary: str


class FilteredReply(BaseModel):
    text: str
    leaks: list[LeakHit]
    blocked: bool


class Gateway:
    def __init__(self, rules: list[Rule], limits: Limits, mode: Mode) -> None:
        self.rules = rules
        self.limits = limits
        self.mode = mode

    def _broken_rule(self, action: Action) -> str | None:
        """Return the ID of the first rule that this action breaks, if any."""
        args = action.args
        for rule in self.rules:
            check = rule.check
            p = check.params
            if (
                (
                    check.type == "max_discount"
                    and action.tool == "give_discount"
                    and "percent" in p
                    and args["percent"] > p["percent"]
                )
                or (
                    check.type == "max_refund"
                    and action.tool == "refund"
                    and "amount_nok" in p
                    and args["amount_nok"] > p["amount_nok"]
                )
                or (
                    check.type == "refund_original_only"
                    and action.tool == "refund"
                    and args.get("to_account") is not None
                )
                or (check.type == "tool_not_allowed" and action.tool == p.get("tool"))
            ):
                return rule.id
        return None

    def apply(self, action: Action, shop: ShopState) -> GatewayDecision:
        model = ARG_MODELS.get(action.tool)
        if model is None:
            return GatewayDecision(
                decision="blocked",
                rule_id=None,
                result=f"Ukjent verktøy: {action.tool}.",
                result_summary="Ukjent verktøy blokkert",
            )
        try:
            validated = model.model_validate(action.args)
        except ValidationError:
            return GatewayDecision(
                decision="blocked",
                rule_id=None,
                result="Ugyldige argumenter for verktøyet.",
                result_summary=f"Ugyldige argumenter til {action.tool}",
            )
        action = Action(tool=action.tool, args=validated.model_dump())
        rule_id = self._broken_rule(action)
        result, summary = run_tool(action, shop, self.limits.hide_address_phone)
        return GatewayDecision(
            decision="flagged" if rule_id else "allowed",
            rule_id=rule_id,
            result=result,
            result_summary=summary,
        )

    def filter_reply(self, text: str, shop: ShopState, true_identity: str | None) -> FilteredReply:
        leaks = find_leaks(text, shop, true_identity)
        return FilteredReply(text=text, leaks=leaks, blocked=False)
