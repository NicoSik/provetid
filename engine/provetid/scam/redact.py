"""Clean a pasted scam message in code, before any model or file sees it (REQ-6.1).

The text is first normalised: Unicode compatibility forms, odd spaces and hyphens become plain
ones, and defanged links («evil[.]no», «hxxps://») are turned back into links, so they are
caught. The patterns then run from the most specific to the least, so a card number is not
half taken by the phone pattern. When in doubt they replace too much: for a scam that is safe.
"""

import re
import unicodedata

from pydantic import BaseModel

_SPACES = re.compile(r"[^\S\n]+")  # any run of whitespace except a line break
_HYPHENS = re.compile(r"[‐-―−﹘﹣－]")
_DEFANG = [
    (re.compile(r"\[\.\]|\(\.\)|\[dot\]|\(dot\)", re.I), "."),
    (re.compile(r"\bhxxp", re.I), "http"),
    (re.compile(r"\b(https?) +://", re.I), r"\1://"),
]
_SEP = r"[ .-]?"  # one optional separator between digit groups
_END = r"[^\s.,!?;:)»\"']"  # a link does not end in sentence punctuation
# A bare domain (no scheme, no path) must end in a common top-level domain, written in lower
# case or all in capitals. Otherwise «Hei.Jeg» or «Kari.Pakken», a missing space after a full
# stop, would look like a domain. The first label needs 2+ characters, so «f.eks» is no domain.
_TLDS = (
    "no|com|net|org|info|io|xyz|top|site|online|shop|store|app|me|co|eu|de|se|dk|fi|uk|biz"
    "|link|live|club|cc|ru|cn|icu|vip|sbs|buzz|cfd|click|tk|ml|ga|cf|gq|pw|ws|ly|help|support"
    "|example"
)
_BARE_DOMAIN = (
    rf"(?-i:[\w-]{{2,}}(?:\.[\w-]+)*\.(?:{_TLDS})\b"
    rf"|[A-ZÆØÅ0-9-]{{2,}}(?:\.[A-ZÆØÅ0-9-]+)*\.(?:{_TLDS.upper()})\b)"
)
# A domain followed by a path or query: any lower-case top level of 2+ letters, or punycode.
_PATH_DOMAIN = r"(?-i:[\w-]+(?:\.[\w-]+)*\.(?:[a-zæøå]{2,24}|xn--[\w-]+))[/?#]\S*"
# Not a phone number: a year range («2024-2025», «2024 2025») or a date («07.11.2026»).
_NOT_DATE = (
    r"(?!(?:19|20)\d\d[ .-](?:19|20)\d\d(?!\d))"
    r"(?!\d{1,2}[.-]\d{1,2}[.-](?:19|20)\d\d(?!\d))"
    r"(?!(?:19|20)\d\d[.-]\d{1,2}[.-]\d{1,2}(?!\d))"
)
_NUMBER_START = r"(?<![\d+])(?<!\d[.-])"  # never start inside a dotted or dashed number
_PHONE_SEP = r"[ .\n-]?"  # a phone number may also break across a line

_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("emails", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[E-POST]"),
    (
        "links",
        re.compile(
            rf"https?://\S*{_END}|\bwww\.\S*{_END}|\b{_PATH_DOMAIN}{_END}|\b{_BARE_DOMAIN}",
            re.I,
        ),
        "[LENKE]",
    ),
    ("accounts", re.compile(r"\bNO\d{2}(?: ?\d){11}(?!\d)", re.I), "[KONTONUMMER]"),  # IBAN
    (
        "phones",
        re.compile(rf"(?<![\w+])\+\d{{1,3}}{_SEP}(?:\d{_SEP}){{6,12}}\d(?!\d)"),
        "[TELEFON]",
    ),
    ("cards", re.compile(rf"{_NUMBER_START}(?:\d{_SEP}){{12,18}}\d(?!\d)"), "[KORTNUMMER]"),
    (
        "accounts",
        re.compile(rf"{_NUMBER_START}\d{{4}}{_SEP}\d{{2}}{_SEP}\d{{5}}(?!\d)"),
        "[KONTONUMMER]",
    ),
    (
        "phones",
        re.compile(rf"{_NUMBER_START}{_NOT_DATE}(?:(?:00)?47 ?)?(?:\d{_PHONE_SEP}){{7}}\d(?!\d)"),
        "[TELEFON]",
    ),
]
_NAMES = ("links", "phones", "emails", "accounts", "cards")


class RedactResult(BaseModel):
    text: str
    counts: dict[str, int]


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _SPACES.sub(" ", text)
    text = _HYPHENS.sub("-", text)
    for pattern, replacement in _DEFANG:
        text = pattern.sub(replacement, text)
    return text


def redact(text: str) -> RedactResult:
    text = _normalise(text)
    counts: dict[str, int] = {name: 0 for name in _NAMES}
    for name, pattern, placeholder in _PATTERNS:
        text, found = pattern.subn(placeholder, text)
        counts[name] += found
    return RedactResult(text=text, counts=counts)
