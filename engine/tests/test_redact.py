import pytest

from provetid.scam.redact import redact

# The scam texts are made up. Links use example domains; numbers are not real.
SCAM = (
    "Hei! Pakken din står fast. Betal 29 kr på https://pakke-hjelp.example/betal?id=1 "
    "eller www.frakt-gebyr.example/no. Ring oss på 912 34 567 eller svar til "
    "kundeservice@frakt.example. Overfør til konto 1234.56.78903, eller oppgi kortet "
    "4111 1111 1111 1111."
)


def test_redaction_removes_links_phones_emails_accounts() -> None:
    result = redact(SCAM)
    for raw in (
        "https://pakke-hjelp.example",
        "www.frakt-gebyr.example",
        "912 34 567",
        "kundeservice@frakt.example",
        "1234.56.78903",
        "4111 1111 1111 1111",
    ):
        assert raw not in result.text
    assert result.text.count("[LENKE]") == 2
    assert "[TELEFON]" in result.text
    assert "[E-POST]" in result.text
    assert "[KONTONUMMER]" in result.text
    assert "[KORTNUMMER]" in result.text
    assert result.counts == {"links": 2, "phones": 1, "emails": 1, "accounts": 1, "cards": 1}


@pytest.mark.parametrize(
    "raw, placeholder",
    [
        ("+47 912 34 567", "[TELEFON]"),
        ("+4791234567", "[TELEFON]"),
        ("0047 91234567", "[TELEFON]"),
        ("91234567", "[TELEFON]"),
        ("91 23 45 67", "[TELEFON]"),
        ("1234 56 78903", "[KONTONUMMER]"),
        ("12345678903", "[KONTONUMMER]"),
        ("4111-1111-1111-1111", "[KORTNUMMER]"),
        ("hjelp.example/sak/123", "[LENKE]"),
        ("http://kort.example", "[LENKE]"),
        # bare domains, the usual form in Norwegian scam SMS
        ("pakke-hjelp.no", "[LENKE]"),
        ("posten-no.info", "[LENKE]"),
        ("pakke-hjelp.no?id=3", "[LENKE]"),
        ("blåbær.no/x", "[LENKE]"),
        ("PAKKE-HJELP.NO", "[LENKE]"),
        # defanged links
        ("evil[.]no/betal", "[LENKE]"),
        ("hxxps://evil.example/x", "[LENKE]"),
        ("https ://evil.example/x", "[LENKE]"),
        # numbers with other separators, and foreign numbers
        ("912\u00a034\u00a0567", "[TELEFON]"),
        ("9123\u20114567", "[TELEFON]"),
        ("912.34.567", "[TELEFON]"),
        ("+46 70 123 45 67", "[TELEFON]"),
        ("+44 7700 900123", "[TELEFON]"),
        ("1234-56-78903", "[KONTONUMMER]"),
        ("1234\u00a056\u00a078903", "[KONTONUMMER]"),
        ("NO93 8601 1117 947", "[KONTONUMMER]"),
        # a phone right after another number, or with 47 but no +
        ("47 91234567", "[TELEFON]"),
        ("47 912 34 567", "[TELEFON]"),
        ("912\n34 567", "[TELEFON]"),
        ("t.co/x", "[LENKE]"),
        ("g.co/abc?d=1", "[LENKE]"),
    ],
)
def test_the_norwegian_formats_are_replaced(raw: str, placeholder: str) -> None:
    result = redact(f"Se {raw} nå.")
    assert raw not in result.text
    assert result.text == f"Se {placeholder} nå."


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Tlf: 47 91234567.", "Tlf: [TELEFON]."),
        ("ordre 1043 91234567", "ordre 1043 [TELEFON]"),
        ("Pris 299 91234567", "Pris 299 [TELEFON]"),
        ("Org.nr. 912 345 678.", "Org.nr. 912 345 678."),
    ],
)
def test_a_phone_after_another_number_is_still_found(text: str, expected: str) -> None:
    assert redact(text).text == expected


@pytest.mark.parametrize(
    "text",
    [
        "Det koster 29 kr.",
        "Ordre 1043 er sendt.",
        "Vi har åpent 10:00-17:00.",
        "Hei Kari!",
        "Gjelder sesongen 2024-2025.",
        "Ta f.eks. en pumpe, bl.a. til 1.5/2 liter.",
        "Kom kl. 10.30/11.00 i morgen.",
        "Pris: 1 290 kr.",
        # dates, common as deadlines in scam texts
        "Betal innen 07.11.2026.",
        "Sendt 2024-11-07.",
        "Fra 2024.11.07 kl 14.30.",
        "Årene 2024 2025 2026.",
        # a missing space after a full stop is not a link
        "Hei.Jeg har en pakke.",
        "Takk Kari.Pakken kommer.",
        "osv.Neste uke.",
        "Org.nr. 000 000 000.",
        "Bor på St.Hanshaugen.",
        "Dr.Hansen ringte.",
        "Shimano.Deore er bra.",
        "Ola.Nordmann skrev.",
        "Se S01.json.",
    ],
)
def test_ordinary_text_stays_unchanged(text: str) -> None:
    result = redact(text)
    assert result.text == text
    assert sum(result.counts.values()) == 0


def test_redacting_twice_gives_the_same_text() -> None:
    once = redact(SCAM).text
    assert redact(once).text == once
    assert sum(redact(once).counts.values()) == 0
