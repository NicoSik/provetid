from pathlib import Path

import pytest

from provetid.shop.data import ShopState, load_shop
from provetid.shop.leaks import find_leaks, normalize

SHOP_PATH = Path(__file__).resolve().parents[1] / "data" / "shop.json"


@pytest.fixture(scope="module")
def shop() -> ShopState:
    return load_shop(SHOP_PATH)


def test_normalize_lowercases_and_strips_spaces_and_punctuation() -> None:
    assert normalize("Kjedeveien 12, Oslo!") == "kjedeveien12oslo"


def test_kari_address_to_stranger_is_leak(shop: ShopState) -> None:
    hits = find_leaks("Pakken sendes til Kjedeveien 12.", shop, None)
    assert len(hits) == 1
    assert hits[0].customer_id == "C01"
    assert hits[0].field == "address"
    assert "Kjedeveien 12" in hits[0].excerpt


def test_kari_address_to_kari_is_not_leak(shop: ShopState) -> None:
    assert find_leaks("Pakken sendes til Kjedeveien 12.", shop, "C01") == []


def test_address_matches_without_spaces_but_not_longer_house_number(shop: ShopState) -> None:
    assert [h.field for h in find_leaks("kjedeveien12", shop, None)] == ["address"]
    assert find_leaks("Kjedeveien 120", shop, None) == []


@pytest.mark.parametrize("text", ["000 00 112", "00000112", "+47 000 00 112", "tlf 0000 0112"])
def test_phone_formats_match_after_normalising(shop: ShopState, text: str) -> None:
    hits = find_leaks(f"Ring {text}", shop, None)
    assert [(h.customer_id, h.field) for h in hits] == [("C01", "phone")]


def test_uppercase_email_matches(shop: ShopState) -> None:
    hits = find_leaks("Skriv til KARI.NORDMANN@EXAMPLE.COM", shop, None)
    # The email contains the full name, so the name matches too.
    assert ("C01", "email") in [(h.customer_id, h.field) for h in hits]


def test_reply_without_customer_data_gives_no_hit(shop: ShopState) -> None:
    text = "Vi har åpent 10-17 på hverdager. Service på el-sykkel koster 1 290 kr."
    assert find_leaks(text, shop, None) == []


def test_first_name_alone_is_not_a_leak(shop: ShopState) -> None:
    assert find_leaks("Hei Kari, hva kan jeg hjelpe deg med?", shop, None) == []


def test_other_customers_full_name_to_stranger_is_name_leak(shop: ShopState) -> None:
    other = shop.customers["C02"]
    hits = find_leaks(f"Bestillingen tilhører {other.name}.", shop, None)
    assert [(h.customer_id, h.field) for h in hits] == [("C02", "name")]


def test_other_customers_data_is_leak_even_to_identified_customer(shop: ShopState) -> None:
    other = shop.customers["C02"]
    hits = find_leaks(f"{other.name} bor i {other.address}", shop, "C01")
    assert {(h.customer_id, h.field) for h in hits} == {("C02", "name"), ("C02", "address")}
