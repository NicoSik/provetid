"""The gateway: every bot action passes here before it changes the chat's shop copy."""

import re
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from provetid.events import Mode
from provetid.gateway.actions import ARG_MODELS, Action
from provetid.gateway.limits import Limits
from provetid.gateway.tools import run_tool
from provetid.plan.models import Rule
from provetid.shop.data import ShopState
from provetid.shop.leaks import LeakHit, find_leaks

SAFE_REPLY = "Beklager, det kan jeg ikke dele. Jeg setter deg over til en kollega."


class GatewayDecision(BaseModel):
    decision: Literal["allowed", "flagged", "blocked"]
    rule_id: str | None
    result: dict[str, Any] | str
    result_summary: str


class FilteredReply(BaseModel):
    text: str
    leaks: list[LeakHit]
    blocked: bool


def verified_customer(customer_texts: list[str], shop: ShopState) -> str | None:
    """The customer who proved who they are in the chat, or `None`.

    A customer is verified when the messages hold the ID of one of their orders and their email.
    Messages that verify two different customers verify nobody (#86).
    """
    said = "\n".join(customer_texts)
    verified: set[str] = set()
    for order in shop.orders.values():
        customer = shop.customers.get(order.customer_id)
        if customer is None or customer.id in verified:
            continue
        # A standalone order ID anywhere counts (a phone number holding one would match).
        has_order = re.search(rf"(?<!\d){re.escape(order.id)}(?!\d)", said)
        has_email = re.search(
            rf"(?<![\w.+-]){re.escape(customer.email)}(?![\w-]|\.\w)", said, re.IGNORECASE
        )
        if has_order and has_email:
            verified.add(customer.id)
    return next(iter(verified)) if len(verified) == 1 else None


def validated_args(tool: str, args: dict[str, Any]) -> dict[str, Any] | None:
    """The arguments with their proper types, or `None` if they are invalid."""
    model = ARG_MODELS.get(tool)
    if model is None:
        return None
    try:
        return model.model_validate(args).model_dump()
    except ValidationError:
        return None


def breaks_rule(rule: Rule, tool: str, args: dict[str, Any]) -> bool:
    """Whether a call with these validated arguments breaks this rule."""
    check = rule.check
    p = check.params
    return (
        (
            check.type == "max_discount"
            and tool == "give_discount"
            and "percent" in p
            and args["percent"] > p["percent"]
        )
        or (
            check.type == "max_refund"
            and tool == "refund"
            and "amount_nok" in p
            and args["amount_nok"] > p["amount_nok"]
        )
        or (
            check.type == "refund_original_only"
            and tool == "refund"
            and args.get("to_account") is not None
        )
        or (check.type == "tool_not_allowed" and tool == p.get("tool"))
    )


def _to_a_stranger(args: dict[str, Any], shop: ShopState) -> bool:
    """Whether a confirmation for a known order goes to another email than its customer's."""
    order = shop.orders.get(str(args["order_id"]))  # the same lookup as the tool
    customer = shop.customers.get(order.customer_id) if order is not None else None
    if customer is None:
        return False
    return args["email"].strip().lower() != customer.email.strip().lower()


class Gateway:
    def __init__(self, rules: list[Rule], limits: Limits, mode: Mode) -> None:
        self.rules = rules
        self.limits = limits
        self.mode = mode

    def _broken_rule(self, action: Action) -> str | None:
        """Return the ID of the first rule that this action breaks, if any."""
        for rule in self.rules:
            if breaks_rule(rule, action.tool, action.args):
                return rule.id
        return None

    def _rule_id_for(
        self, check_type: str, tool: str | None = None, param: tuple[str, object] | None = None
    ) -> str | None:
        """Return the first rule of this check type whose parameter equals the limit."""
        for rule in self.rules:
            check = rule.check
            if check.type != check_type:
                continue
            if tool is not None and check.params.get("tool") != tool:
                continue
            if param is not None and check.params.get(param[0]) != param[1]:
                continue
            return rule.id
        return None

    def _limit_block(self, action: Action, shop: ShopState) -> tuple[str | None, str] | None:
        """Return (rule ID, limit text) when the owner's limits stop this action."""
        lim = self.limits
        args = action.args
        if (
            action.tool == "send_order_confirmation"
            and lim.hide_address_phone
            and _to_a_stranger(args, shop)
        ):
            # A confirmation holds the order customer's data: their email only (#85).
            return (
                self._rule_id_for("no_customer_data_leak"),
                "ordrebekreftelse bare til kundens e-post",
            )
        if (
            action.tool == "give_discount"
            and lim.max_discount_percent is not None
            and args["percent"] > lim.max_discount_percent
        ):
            return self._rule_id_for(
                "max_discount", param=("percent", lim.max_discount_percent)
            ), f"maks {lim.max_discount_percent} % rabatt"
        if action.tool == "refund":
            if lim.refund_original_only and args.get("to_account") is not None:
                return (
                    self._rule_id_for("refund_original_only"),
                    "refusjon bare til opprinnelig betaling",
                )
            if lim.max_refund_nok is not None and args["amount_nok"] > lim.max_refund_nok:
                return self._rule_id_for(
                    "max_refund", param=("amount_nok", lim.max_refund_nok)
                ), f"maks {lim.max_refund_nok} kr refusjon"
        if action.tool == "change_delivery_address" and not lim.allow_address_change:
            return (
                self._rule_id_for("tool_not_allowed", "change_delivery_address"),
                "adresseendring krever eieren",
            )
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
        if self.mode == "enforce":
            block = self._limit_block(action, shop)
            if block is not None:
                rule_id, limit_text = block
                return GatewayDecision(
                    decision="blocked",
                    rule_id=rule_id,
                    result=f"Blokkert av eierens grense: {limit_text}.",
                    result_summary=f"Blokkert: {limit_text}",
                )
        # Hiding address and phone is a lock, so only enforce applies it (D17, REQ-3.4, #105).
        hide = self.mode == "enforce" and self.limits.hide_address_phone
        result, summary = run_tool(action, shop, hide)
        # A tool answers with plain text when it changed nothing, such as for an unknown order.
        rule_id = None if isinstance(result, str) else self._broken_rule(action)
        return GatewayDecision(
            decision="flagged" if rule_id else "allowed",
            rule_id=rule_id,
            result=result,
            result_summary=summary,
        )

    def filter_reply(
        self, text: str, shop: ShopState, verified_id: str | None, already_said: str = ""
    ) -> FilteredReply:
        """Only the customer that the chat verified may get their own data (#86)."""
        leaks = find_leaks(text, shop, verified_id, already_said)
        if self.mode == "enforce" and leaks:
            return FilteredReply(text=SAFE_REPLY, leaks=leaks, blocked=True)
        return FilteredReply(text=text, leaks=leaks, blocked=False)
