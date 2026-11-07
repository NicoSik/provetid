from pathlib import Path

import pytest

from provetid.gateway.actions import Action
from provetid.gateway.limits import Limits, limits_from_rules
from provetid.gateway.tools import run_tool
from provetid.shop.data import ShopState, load_shop
from tests.conftest import R1, R2, R3, R7

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"


@pytest.fixture
def shop() -> ShopState:
    return load_shop(SHOP_PATH).copy_for_chat()


@pytest.mark.parametrize("query", ["000 00 112", "00000112", "000-00-112", "+47 000 00 112"])
def test_lookup_customer_finds_c01_by_phone_in_any_format(shop: ShopState, query: str) -> None:
    result, summary = run_tool(
        Action(tool="lookup_customer", args={"query": query}), shop, hide_address_phone=False
    )
    assert isinstance(result, dict)
    assert result["id"] == "C01"
    assert result["address"] == "Kjedeveien 12"
    assert result["phone"] == "000 00 112"
    assert summary


def test_lookup_customer_hides_address_and_phone_when_set(shop: ShopState) -> None:
    result, _ = run_tool(
        Action(tool="lookup_customer", args={"query": "kari.nordmann@example.com"}),
        shop,
        hide_address_phone=True,
    )
    assert isinstance(result, dict)
    assert result["name"] == "Kari Nordmann"
    assert "address" not in result
    assert "phone" not in result


def test_lookup_order_returns_full_record_and_can_hide_address(shop: ShopState) -> None:
    action = Action(tool="lookup_order", args={"order_id": "1043"})
    full, _ = run_tool(action, shop, hide_address_phone=False)
    assert isinstance(full, dict)
    assert full["delivery_address"] == "Kjedeveien 12, 0000 Oslo"
    hidden, _ = run_tool(action, shop, hide_address_phone=True)
    assert isinstance(hidden, dict)
    assert "delivery_address" not in hidden


def test_unknown_order_gives_error_text(shop: ShopState) -> None:
    result, summary = run_tool(
        Action(tool="lookup_order", args={"order_id": "9999"}), shop, hide_address_phone=False
    )
    assert isinstance(result, str)
    assert summary


def test_send_order_confirmation_records_email(shop: ShopState) -> None:
    run_tool(
        Action(
            tool="send_order_confirmation",
            args={"order_id": "1043", "email": "kari.nordmann@example.com"},
        ),
        shop,
        hide_address_phone=False,
    )
    assert shop.sent_emails == [{"order_id": "1043", "email": "kari.nordmann@example.com"}]


def test_limits_from_rules_maps_demo_rules() -> None:
    assert limits_from_rules([R1]) == Limits(max_discount_percent=10)
    assert limits_from_rules([R2]) == Limits(hide_address_phone=True)
    assert limits_from_rules([R3]) == Limits(refund_original_only=True)
    assert limits_from_rules([R7]) == Limits(allow_address_change=False)
    assert limits_from_rules([R1, R2, R3, R7]) == Limits(
        max_discount_percent=10,
        hide_address_phone=True,
        refund_original_only=True,
        allow_address_change=False,
    )
