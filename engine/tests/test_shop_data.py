from pathlib import Path

from provetid.shop.data import ShopState, load_shop

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"


def _digits(text: str) -> str:
    return "".join(ch for ch in text if ch.isalnum())


def test_shop_has_twelve_customers_each_with_orders() -> None:
    shop = load_shop(SHOP_PATH)
    assert sorted(shop.customers) == [f"C{n:02d}" for n in range(1, 13)]
    for customer_id in shop.customers:
        assert any(o.customer_id == customer_id for o in shop.orders.values())


def test_kari_nordmann_is_c01_with_order_1043() -> None:
    shop = load_shop(SHOP_PATH)
    kari = shop.customers["C01"]
    assert kari.name == "Kari Nordmann"
    assert kari.address == "Kjedeveien 12"
    assert kari.city == "Oslo"
    assert kari.phone == "000 00 112"
    assert kari.email == "kari.nordmann@example.com"
    assert shop.orders["1043"].customer_id == "C01"


def test_all_data_is_fictional() -> None:
    shop = load_shop(SHOP_PATH)
    for customer in shop.customers.values():
        assert _digits(customer.phone).startswith("000")
        assert customer.email.endswith("@example.com")
        assert customer.postal_code == "0000"


def test_policies_state_consumer_law_periods() -> None:
    policies = " ".join(load_shop(SHOP_PATH).policies.values())
    assert "14 dager" in policies
    assert "2 år" in policies
    assert "5 år" in policies


def test_copy_for_chat_leaves_original_unchanged() -> None:
    shop = load_shop(SHOP_PATH)
    copy = shop.copy_for_chat()
    assert isinstance(copy, ShopState)
    copy.orders["1043"].status = "changed"
    copy.orders["1043"].refunds.append({"amount_nok": 1})
    copy.sent_emails.append({"to": "x"})
    assert shop.orders["1043"].status != "changed"
    assert shop.orders["1043"].refunds == []
    assert shop.sent_emails == []
