from pathlib import Path

import pytest

from provetid.gateway.actions import Action
from provetid.gateway.gateway import Gateway
from provetid.gateway.limits import Limits, limits_from_rules
from provetid.plan.models import Check, Rule
from provetid.shop.data import ShopState, load_shop
from tests.conftest import R1, R2, R3, R7

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"
RULES: list[Rule] = [R1, R2, R3, R7]


@pytest.fixture
def shop() -> ShopState:
    return load_shop(SHOP_PATH).copy_for_chat()


@pytest.fixture
def gateway() -> Gateway:
    return Gateway(RULES, limits_from_rules(RULES), "observe")


def test_discount_over_limit_is_flagged_in_observe(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 60}), shop)
    assert d.decision == "flagged"
    assert d.rule_id == "R1"
    assert shop.orders["1043"].discount_percent == 60


def test_discount_within_limit_is_allowed(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 10}), shop)
    assert d.decision == "allowed"
    assert d.rule_id is None
    assert shop.orders["1043"].discount_percent == 10


def test_refund_to_other_account_is_flagged(gateway: Gateway, shop: ShopState) -> None:
    action = Action(
        tool="refund", args={"order_id": "1043", "amount_nok": 500, "to_account": "0000.00.00000"}
    )
    d = gateway.apply(action, shop)
    assert d.decision == "flagged"
    assert d.rule_id == "R3"


def test_refund_to_original_payment_is_allowed(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(Action(tool="refund", args={"order_id": "1043", "amount_nok": 500}), shop)
    assert d.decision == "allowed"
    assert shop.orders["1043"].refunds


def test_refund_above_max_refund_is_flagged(shop: ShopState) -> None:
    rule = Rule(
        id="R9",
        text="Maks 500 kr refusjon",
        category="money",
        check=Check(type="max_refund", params={"amount_nok": 500}),
    )
    gw = Gateway([rule], limits_from_rules([rule]), "observe")
    d = gw.apply(Action(tool="refund", args={"order_id": "1043", "amount_nok": 900}), shop)
    assert d.decision == "flagged"
    assert d.rule_id == "R9"


def test_change_address_is_flagged_by_tool_not_allowed(gateway: Gateway, shop: ShopState) -> None:
    action = Action(
        tool="change_delivery_address",
        args={"order_id": "1043", "address": "Annenveien 1, 0000 Oslo"},
    )
    d = gateway.apply(action, shop)
    assert d.decision == "flagged"
    assert d.rule_id == "R7"
    assert shop.orders["1043"].delivery_address == "Annenveien 1, 0000 Oslo"


def test_unknown_tool_is_blocked(gateway: Gateway, shop: ShopState) -> None:
    before = shop.model_copy(deep=True)
    action = Action.model_construct(tool="delete_everything", args={})
    d = gateway.apply(action, shop)
    assert d.decision == "blocked"
    assert d.rule_id is None
    assert isinstance(d.result, str) and d.result
    assert shop == before


def test_invalid_arguments_are_blocked(gateway: Gateway, shop: ShopState) -> None:
    before = shop.model_copy(deep=True)
    d = gateway.apply(Action(tool="give_discount", args={"order_id": "1043"}), shop)
    assert d.decision == "blocked"
    assert d.rule_id is None
    assert shop == before


def test_filter_reply_in_observe_reports_leak_and_keeps_text(
    gateway: Gateway, shop: ShopState
) -> None:
    text = "Kari bor på Kjedeveien 12."
    out = gateway.filter_reply(text, shop, true_identity=None)
    assert out.text == text
    assert not out.blocked
    assert any(h.customer_id == "C01" and h.field == "address" for h in out.leaks)


def test_string_number_is_coerced_and_flagged(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(
        Action(tool="give_discount", args={"order_id": "1043", "percent": "60"}), shop
    )
    assert d.decision == "flagged"
    assert d.rule_id == "R1"
    assert shop.orders["1043"].discount_percent == 60


def test_string_refund_amount_does_not_crash(shop: ShopState) -> None:
    rule = Rule(
        id="R9",
        text="Maks 500 kr refusjon",
        category="money",
        check=Check(type="max_refund", params={"amount_nok": 500}),
    )
    gw = Gateway([rule], limits_from_rules([rule]), "observe")
    d = gw.apply(Action(tool="refund", args={"order_id": "1043", "amount_nok": "900"}), shop)
    assert d.decision == "flagged"


def test_rules_without_params_do_not_crash_or_set_limits(shop: ShopState) -> None:
    rules = [
        Rule(id="R8", text="x", category="money", check=Check(type="max_discount")),
        Rule(id="R9", text="y", category="money", check=Check(type="max_refund")),
    ]
    assert limits_from_rules(rules) == Limits()
    gw = Gateway(rules, limits_from_rules(rules), "observe")
    d1 = gw.apply(Action(tool="give_discount", args={"order_id": "1043", "percent": 50}), shop)
    d2 = gw.apply(Action(tool="refund", args={"order_id": "1043", "amount_nok": 900}), shop)
    assert d1.decision == "allowed"
    assert d2.decision == "allowed"


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        ("give_discount", {"order_id": "1043", "percent": -5}),
        ("give_discount", {"order_id": "1043", "percent": 101}),
        ("refund", {"order_id": "1043", "amount_nok": -500}),
        ("refund", {"order_id": "1043", "amount_nok": 0}),
    ],
)
def test_out_of_range_values_are_blocked(
    gateway: Gateway, shop: ShopState, tool: str, args: dict[str, int | str]
) -> None:
    before = shop.model_copy(deep=True)
    d = gateway.apply(Action(tool=tool, args=args), shop)  # type: ignore[arg-type]
    assert d.decision == "blocked"
    assert d.rule_id is None
    assert shop == before


def test_hide_path_masks_address_and_phone_in_result(gateway: Gateway, shop: ShopState) -> None:
    d = gateway.apply(Action(tool="lookup_customer", args={"query": "000 00 112"}), shop)
    assert isinstance(d.result, dict)
    assert d.result["address"] == "Kjedeveien **"
    assert d.result["phone"] == "*** ** 112"
    assert "postal_code" not in d.result
    assert "city" not in d.result
