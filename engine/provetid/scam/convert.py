"""Turn a cleaned scam message into a fake attacker with the converter role (REQ-6.2).

The input is cleaned again here, so nothing raw can reach the model even if a caller forgets.
The model's output is cleaned too, in case it writes a number of its own.
"""

import json
from pathlib import Path

from pydantic import BaseModel

from provetid.config import DEFAULT_DATA_DIR
from provetid.plan.models import FakeCustomer, Rule
from provetid.runner.prompts import load_prompt
from provetid.scam.redact import redact
from provetid.transport.base import Transport

DEFAULT_RULE = "R2"  # every scam in the library at least tries to get customer data
TARGET = {"name": "Kari Nordmann", "order": "1043"}  # the customer every attacker is after


class ConverterOutput(BaseModel):
    scam_type: str
    anonymized_text: str
    name: str
    label: str
    claims_to_be: str
    goal: str
    opening: str
    tactics: list[str]
    target_rules: list[str]
    poses_as_customer: bool


class Conversion(BaseModel):
    text: str  # the cleaned message with names as [NAVN], the only text that is shown or stored
    scam_type: str
    customer: FakeCustomer


def library_types(data_dir: Path = DEFAULT_DATA_DIR) -> list[dict[str, str]]:
    folder = data_dir / "scams" / "library"
    return [
        {"id": p.stem, "label": json.loads(p.read_text("utf-8"))["label"]}
        for p in sorted(folder.glob("S*.json"))
    ]


def _system_prompt(data_dir: Path, rules: list[Rule]) -> str:
    types = "\n".join(f"- {t['id']}: {t['label']}" for t in library_types(data_dir))
    rule_lines = "\n".join(f"- {r.id}: {r.text}" for r in rules)
    return (
        f"{load_prompt('converter.md').strip()}\n\n## Kjente svindeltyper\n\n{types}"
        f"\n\n## Butikkens regler\n\n{rule_lines}"
    )


def _clean(text: str) -> str:
    return redact(text).text


async def convert_scam(
    text: str, transport: Transport, *, rules: list[Rule], data_dir: Path = DEFAULT_DATA_DIR
) -> Conversion:
    """Convert with the test plan's own rules, so an attacker only targets rules the run has."""
    clean_input = _clean(text)
    result = await transport.call(
        "converter", _system_prompt(data_dir, rules), clean_input, ConverterOutput
    )
    out = result.data
    assert isinstance(out, ConverterOutput)
    plan_ids = [r.id for r in rules]
    fallback = [DEFAULT_RULE] if DEFAULT_RULE in plan_ids else plan_ids[:1]
    targets = [r for r in out.target_rules if r in plan_ids] or fallback
    # Same keys as the scam library, so the customer frame knows whose name is whose.
    name_key = "navnet_du_bruker" if out.poses_as_customer else "kunden_du_spør_om"
    customer = FakeCustomer(
        id="innsendt",
        name=_clean(out.name),
        kind="scam",
        label=_clean(out.label),
        source="innsendt",
        target_rules=targets,
        claims_to_be=_clean(out.claims_to_be),
        really_is=None,
        goal=_clean(out.goal),
        knows={name_key: TARGET["name"], "ordre": TARGET["order"]},
        opening=_clean(out.opening),
        tactics=[_clean(t) for t in out.tactics],
        max_messages=4,
    )
    return Conversion(text=_clean(out.anonymized_text), scam_type=out.scam_type, customer=customer)
