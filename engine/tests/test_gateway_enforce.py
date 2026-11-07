from pathlib import Path

import pytest

from provetid.gateway.actions import Action
from provetid.gateway.gateway import Gateway
from provetid.gateway.limits import Limits, limits_from_rules
from provetid.plan.models import Check, Rule
from provetid.shop.data import ShopState, load_shop
from provetid.shop.leaks import find_leaks
from tests.conftest import R1, R2, R3, R7

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"
R9 = Rule(
    id="R9",
    text="Maks 2000 kr refusjon",
    category="money",
    check=Check(type="max_refund", params={"amount_nok": 2000}),
)
RULES: list[Rule] = [R1, R2, R3, R7, R9]
SAFE = "Beklager, det kan jeg ikke dele. Jeg setter deg over til en kollega."


@pytest.fixture
def shop() -> ShopState:
    return load_shop(SHOP_PATH).copy_for_chat()


@pytest.fixture
def gateway() -> Gateway:
    return Gateway(RULES, limits_from_rules(RULES), "enforce")


def test_discount_over_limit_is_blocked_in_enforce(gateway: Gateway, shop: ShopState) -> None:
    before = shop.model_copy(deep=True)
    d = gateway.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 60}), shop)
    assert d.decision == "blocked"
    assert d.rule_id == "R1"
    assert isinstance(d.result, str)
    assert d.result.startswith("Blokkert av eierens grense:")
    assert "maks 10 % rabatt" in d.result
    assert shop == before


def test_refund_to_other_account_is_blocked(gateway: Gateway, shop: ShopState) -> None:
    before = shop.model_copy(deep=True)
    action = Action(
        tool="refund", args={"order_id": "1043", "amount_nok": 500, "to_account": "0000.00.00000"}
    )
    d = gateway.apply(action, shop)
    assert d.decision == "blocked"
    assert d.rule_id == "R3"
    assert isinstance(d.result, str)
    assert "refusjon bare til opprinnelig betaling" in d.result
    assert shop == before


def test_refund_above_max_refund_is_blocked(gateway: Gateway, shop: ShopState) -> None:
    before = shop.model_copy(deep=True)
    d = gateway.apply(Action(tool="refund", args={"order_id": "1043", "amount_nok": 2500}), shop)
    assert d.decision == "blocked"
    assert d.rule_id == "R9"
    assert isinstance(d.result, str)
    assert "maks 2000 kr refusjon" in d.result
    assert shop == before


def test_address_change_is_blocked(gateway: Gateway, shop: ShopState) -> None:
    before = shop.model_copy(deep=True)
    action = Action(
        tool="change_delivery_address",
        args={"order_id": "1043", "address": "Annenveien 1, 0000 Oslo"},
    )
    d = gateway.apply(action, shop)
    assert d.decision == "blocked"
    assert d.rule_id == "R7"
    assert isinstance(d.result, str)
    assert "adresseendring krever eieren" in d.result
    assert shop == before


def test_block_without_matching_rule_has_no_rule_id(shop: ShopState) -> None:
    gw = Gateway([], Limits(max_discount_percent=10), "enforce")
    d = gw.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 60}), shop)
    assert d.decision == "blocked"
    assert d.rule_id is None


def test_actions_within_limits_are_allowed(gateway: Gateway, shop: ShopState) -> None:
    d1 = gateway.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 10}), shop)
    d2 = gateway.apply(Action(tool="refund", args={"order_id": "1043", "amount_nok": 2000}), shop)
    assert d1.decision == "allowed"
    assert d2.decision == "allowed"
    assert shop.orders["1043"].discount_percent == 10
    assert shop.orders["1043"].refunds


def test_lookup_customer_masks_address_and_phone(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(Action(tool="lookup_customer", args={"query": "000 00 112"}), shop)
    assert d.decision == "allowed"
    assert isinstance(d.result, dict)
    assert d.result["address"] == "Kjedeveien **"
    assert d.result["phone"] == "*** ** 112"
    assert "postal_code" not in d.result
    assert "city" not in d.result


def test_masked_values_are_not_leaks(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(Action(tool="lookup_customer", args={"query": "000 00 112"}), shop)
    assert isinstance(d.result, dict)
    text = f"{d.result['address']}, tlf {d.result['phone']}"
    assert find_leaks(text, shop, true_identity=None) == []


def test_filter_reply_replaces_leak_in_enforce(gateway: Gateway, shop: ShopState) -> None:
    out = gateway.filter_reply("Kari bor på Kjedeveien 12.", shop, true_identity=None)
    assert out.blocked
    assert out.text == SAFE
    assert out.leaks


def test_filter_reply_keeps_clean_reply_in_enforce(gateway: Gateway, shop: ShopState) -> None:
    text = "Ordren din er på vei."
    out = gateway.filter_reply(text, shop, true_identity=None)
    assert not out.blocked
    assert out.text == text
    assert out.leaks == []


def _discount_rule(rule_id: str, params: dict[str, int]) -> Rule:
    return Rule(
        id=rule_id,
        text="Rabatt",
        category="money",
        check=Check(type="max_discount", params=params),
    )


def test_block_reports_rule_whose_parameter_equals_limit(shop: ShopState) -> None:
    rules = [_discount_rule("RA", {"percent": 20}), _discount_rule("RB", {"percent": 10})]
    gw = Gateway(rules, limits_from_rules(rules), "enforce")
    d = gw.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 15}), shop)
    assert d.decision == "blocked"
    assert d.rule_id == "RB"
    assert "maks 10 % rabatt" in str(d.result)


def test_block_skips_rule_without_parameter(shop: ShopState) -> None:
    rules = [_discount_rule("RX", {}), _discount_rule("RB", {"percent": 10})]
    gw = Gateway(rules, limits_from_rules(rules), "enforce")
    d = gw.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 15}), shop)
    assert d.decision == "blocked"
    assert d.rule_id == "RB"


def test_refund_check_order_original_only_first(gateway: Gateway, shop: ShopState) -> None:
    action = Action(
        tool="refund", args={"order_id": "1043", "amount_nok": 2500, "to_account": "0000.00.00000"}
    )
    d = gateway.apply(action, shop)
    assert d.decision == "blocked"
    assert d.rule_id == "R3"
    assert "refusjon bare til opprinnelig betaling" in str(d.result)


def test_rule_without_limit_is_flagged_in_enforce(shop: ShopState) -> None:
    rule = Rule(
        id="R5",
        text="Ikke send e-post",
        category="privacy",
        check=Check(type="tool_not_allowed", params={"tool": "send_order_confirmation"}),
    )
    gw = Gateway([rule], limits_from_rules([rule]), "enforce")
    action = Action(
        tool="send_order_confirmation", args={"order_id": "1043", "email": "a@example.com"}
    )
    d = gw.apply(action, shop)
    assert d.decision == "flagged"
    assert d.rule_id == "R5"


def test_lookup_order_masks_delivery_address_in_enforce(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(Action(tool="lookup_order", args={"order_id": "1043"}), shop)
    assert isinstance(d.result, dict)
    assert d.result["delivery_address"] == "Kjedeveien **, 0000 Oslo"


def _confirmation(email: str, order_id: str = "1043") -> Action:
    return Action(tool="send_order_confirmation", args={"order_id": order_id, "email": email})


def test_confirmation_to_a_strangers_email_is_blocked(gateway: Gateway, shop: ShopState) -> None:
    """#85: an order confirmation to another email than the order customer's leaks R2 data."""
    before = shop.model_copy(deep=True)
    d = gateway.apply(_confirmation("svindler@example.com"), shop)
    assert d.decision == "blocked"
    assert d.rule_id == "R2"
    assert isinstance(d.result, str)
    assert d.result.startswith("Blokkert av eierens grense:")
    assert "ordrebekreftelse bare til kundens e-post" in d.result
    assert shop == before


def test_confirmation_to_the_order_customers_email_is_allowed(
    gateway: Gateway, shop: ShopState
) -> None:
    d = gateway.apply(_confirmation("  Kari.Nordmann@example.com "), shop)
    assert d.decision == "allowed"
    assert shop.sent_emails == [{"order_id": "1043", "email": "  Kari.Nordmann@example.com "}]


def test_confirmation_for_an_unknown_order_is_not_blocked(
    gateway: Gateway, shop: ShopState
) -> None:
    d = gateway.apply(_confirmation("svindler@example.com", order_id="9999"), shop)
    assert d.decision == "allowed"
    assert shop.sent_emails == []


def test_confirmation_to_a_stranger_is_allowed_without_the_privacy_lock(shop: ShopState) -> None:
    gw = Gateway(RULES, Limits(hide_address_phone=False), "enforce")
    d = gw.apply(_confirmation("svindler@example.com"), shop)
    assert d.decision == "allowed"


def test_confirmation_to_a_stranger_is_allowed_in_observe(shop: ShopState) -> None:
    gw = Gateway(RULES, limits_from_rules(RULES), "observe")
    d = gw.apply(_confirmation("svindler@example.com"), shop)
    assert d.decision == "allowed"
    assert shop.sent_emails == [{"order_id": "1043", "email": "svindler@example.com"}]
