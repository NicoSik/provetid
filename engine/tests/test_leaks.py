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


def test_a_name_the_customer_said_first_is_not_a_leak(shop: ShopState) -> None:
    """#91: repeating what the fake customer already wrote reveals nothing new."""
    said = "Kortet til Kari Nordmann er misbrukt hos dere, ordre 1043."
    text = "Kari Nordmann kan selv kontakte oss i denne chatten."
    assert find_leaks(text, shop, None, already_said=said) == []


def test_data_the_customer_did_not_say_is_still_a_leak(shop: ShopState) -> None:
    said = "Kortet til Kari Nordmann er misbrukt hos dere."
    hits = find_leaks("Kari Nordmann har nummer 000 00 112.", shop, None, already_said=said)
    assert [(h.customer_id, h.field) for h in hits] == [("C01", "phone")]


def test_already_said_is_compared_without_case_spaces_or_punctuation(shop: ShopState) -> None:
    said = "gjelder KARI-NORDMANN"
    assert find_leaks("Hei, Kari Nordmann.", shop, None, already_said=said) == []


def test_an_address_said_with_more_digits_does_not_cover_the_real_one(shop: ShopState) -> None:
    hits = find_leaks("Hun bor i Kjedeveien 12.", shop, None, already_said="Kjedeveien 120")
    assert [h.field for h in hits] == ["address"]


@pytest.mark.parametrize(
    "text",
    [
        "Hun bor i Kjedeveien 12, 0000 Oslo",
        "Hun bor i Kjedeveien 12 0000 Oslo",
        "Hun bor i Kjedeveien 12,0000 Oslo",
        "Hun bor i kjedeveien 12\n0000 Oslo",
    ],
)
def test_an_address_followed_by_its_postal_code_is_a_leak(shop: ShopState, text: str) -> None:
    """#93: the postal code is a separate number, not more digits of the house number."""
    hits = find_leaks(text, shop, None)
    assert [(h.customer_id, h.field) for h in hits] == [("C01", "address")]
    assert hits[0].excerpt.lower() == "kjedeveien 12"


def test_a_longer_house_number_with_a_postal_code_is_not_a_leak(shop: ShopState) -> None:
    assert find_leaks("Kjedeveien 120, 0000 Oslo", shop, None) == []


def test_the_real_address_after_a_longer_house_number_is_a_leak(shop: ShopState) -> None:
    hits = find_leaks("Ikke Kjedeveien 120, men Kjedeveien 12, 0000 Oslo.", shop, None)
    assert [h.field for h in hits] == ["address"]
    assert hits[0].excerpt == "Kjedeveien 12"


def test_a_phone_number_followed_by_a_separate_number_is_a_leak(shop: ShopState) -> None:
    hits = find_leaks("Ring 000 00 112, 0000 Oslo", shop, None)
    assert [(h.customer_id, h.field) for h in hits] == [("C01", "phone")]


def test_a_phone_number_with_more_digits_is_not_a_leak(shop: ShopState) -> None:
    assert find_leaks("Ring 000 00 1125", shop, None) == []


def test_an_address_the_customer_said_with_its_postal_code_is_not_a_leak(shop: ShopState) -> None:
    said = "Jeg bor i Kjedeveien 12, 0000 Oslo."
    assert find_leaks("Sender til Kjedeveien 12, 0000 Oslo.", shop, None, already_said=said) == []
    assert find_leaks("Sender til Kjedeveien 12.", shop, None, already_said=said) == []


def test_a_longer_house_number_with_a_postal_code_does_not_cover_the_real_one(
    shop: ShopState,
) -> None:
    said = "Kjedeveien 120, 0000 Oslo"
    hits = find_leaks("Hun bor i Kjedeveien 12, 0000 Oslo", shop, None, already_said=said)
    assert [h.field for h in hits] == ["address"]


@pytest.mark.parametrize("text", ["Kjedeveien 12-14", "Kjedeveien 12–14", "Kjedeveien 120-122"])
def test_a_house_number_range_is_not_a_leak_of_its_first_number(shop: ShopState, text: str) -> None:
    assert find_leaks(text, shop, None) == []


def test_a_house_number_range_the_customer_said_does_not_cover_the_real_one(
    shop: ShopState,
) -> None:
    hits = find_leaks("Hun bor i Kjedeveien 12.", shop, None, already_said="Kjedeveien 12-14")
    assert [h.field for h in hits] == ["address"]


def test_a_superscript_after_an_address_does_not_hide_it(shop: ShopState) -> None:
    assert [h.field for h in find_leaks("Kjedeveien 12²", shop, None)] == ["address"]


def test_a_spaced_digit_counts_as_a_separate_number(shop: ShopState) -> None:
    """The accepted cost of #93: «12 0» looks the same as «12 0000 Oslo»."""
    assert [h.field for h in find_leaks("Kjedeveien 12 0", shop, None)] == ["address"]
