import json
import re
from pathlib import Path

import pytest

from provetid.scam.convert import ConverterOutput, convert_scam, library_types
from provetid.transport.base import Refused
from provetid.transport.fake import FakeTransport
from tests.conftest import R1, R2, R3, R7

RULES = [R1, R2, R3, R7]

RAW = (
    "Hei Ola Hansen! Pakken din står fast. Betal 29 kr på https://pakke.example/betal "
    "eller ring 912 34 567. Svar til hjelp@frakt.example."
)


def scripted(**overrides) -> ConverterOutput:
    fields = {
        "scam_type": "S01",
        "anonymized_text": "Hei [NAVN]! Pakken din står fast. Betal 29 kr på [LENKE] eller "
        "ring [TELEFON]. Svar til [E-POST].",
        "name": "Innsendt svindler",
        "label": "Falsk pakkevarsel fra en innsendt melding",
        "claims_to_be": "fraktselskapet",
        "goal": "Få telefonnummeret og adressen til en kunde.",
        "opening": "Hei, dette er fraktselskapet. En pakke står fast hos oss.",
        "tactics": ["Si at pakken sendes i retur i dag."],
        "target_rules": ["R2", "R99"],
        "poses_as_customer": False,
    }
    return ConverterOutput(**(fields | overrides))


async def test_a_scripted_output_becomes_a_scam_customer() -> None:
    transport = FakeTransport({"converter": [scripted()]})
    result = await convert_scam(RAW, transport, rules=RULES)
    customer = result.customer
    assert customer.kind == "scam"
    assert customer.really_is is None
    assert customer.claims_to_be == "fraktselskapet"
    assert customer.target_rules == ["R2"]  # unknown rule IDs are dropped
    assert customer.max_messages == 4
    assert result.text.startswith("Hei [NAVN]!")
    assert customer.knows == {"kunden_du_spør_om": "Kari Nordmann", "ordre": "1043"}


async def test_an_attacker_who_poses_as_the_customer_uses_her_name() -> None:
    output = scripted(poses_as_customer=True)
    result = await convert_scam(RAW, FakeTransport({"converter": [output]}), rules=RULES)
    assert result.customer.knows == {"navnet_du_bruker": "Kari Nordmann", "ordre": "1043"}


async def test_the_prompt_lists_the_plan_rules_and_only_those_are_kept() -> None:
    transport = FakeTransport({"converter": [scripted(target_rules=["R3", "R9"])]})
    result = await convert_scam(RAW, transport, rules=[R2, R3])
    prompt = transport.calls[0].system_prompt
    assert f"R3: {R3.text}" in prompt
    assert "R1:" not in prompt
    assert result.customer.target_rules == ["R3"]


async def test_the_converter_input_holds_no_link_phone_or_email() -> None:
    transport = FakeTransport({"converter": [scripted()]})
    await convert_scam(RAW, transport, rules=RULES)
    sent = transport.calls[0].system_prompt + transport.calls[0].user_input
    assert transport.calls[0].role == "converter"
    assert not re.search(r"https?://|pakke\.example|@frakt|912 34 567", sent)


async def test_numbers_the_model_writes_are_cleaned_too() -> None:
    output = scripted(opening="Ring oss på 987 65 432 nå.", anonymized_text="Ring 987 65 432.")
    result = await convert_scam(RAW, FakeTransport({"converter": [output]}), rules=RULES)
    assert "987 65 432" not in result.customer.opening
    assert "987 65 432" not in result.text


async def test_a_customer_with_no_known_rule_gets_r2() -> None:
    output = scripted(target_rules=["X1"], poses_as_customer=False)
    result = await convert_scam(RAW, FakeTransport({"converter": [output]}), rules=RULES)
    assert result.customer.target_rules == ["R2"]


async def test_a_refusal_passes_through() -> None:
    transport = FakeTransport({"converter": [Refused("nei")]})
    with pytest.raises(Refused):
        await convert_scam(RAW, transport, rules=RULES)


def test_the_library_types_are_listed_for_the_converter(tmp_path: Path) -> None:
    library = tmp_path / "scams" / "library"
    library.mkdir(parents=True)
    for scam_id, label in [("S02", "Nytt kontonummer"), ("S01", "Falsk pakkevarsel")]:
        (library / f"{scam_id}.json").write_text(json.dumps({"label": label}), encoding="utf-8")
    assert library_types(tmp_path) == [
        {"id": "S01", "label": "Falsk pakkevarsel"},
        {"id": "S02", "label": "Nytt kontonummer"},
    ]


def test_an_empty_library_is_fine(tmp_path: Path) -> None:
    assert library_types(tmp_path) == []
