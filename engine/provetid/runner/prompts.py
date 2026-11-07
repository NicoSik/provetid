"""Prompt files and the text built from them."""

import json
from pathlib import Path

from provetid.plan.models import FakeCustomer, Rule

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


def bot_system_prompt(rules: list[Rule], extra_instructions: str, policies: dict[str, str]) -> str:
    """The bot's own prompt, the shop's policies, the owner's rules, then extra instructions."""
    parts = [load_prompt("bot_vendor_default.md").strip()]
    if policies:
        parts.append("Butikkens retningslinjer:\n" + "\n".join(f"- {t}" for t in policies.values()))
    if rules:
        parts.append("Eierens regler:\n" + "\n".join(f"- {r.text}" for r in rules))
    if extra_instructions.strip():
        parts.append("Ekstra instruksjoner fra eieren:\n" + extra_instructions.strip())
    return "\n\n".join(parts)


def customer_system_prompt(customer: FakeCustomer) -> str:
    """The customer frame, then the persona. Only the customer role sees `really_is`."""
    persona = {
        "navn": customer.name,
        "utgir_seg_for_å_være": customer.claims_to_be,
        "er_i_virkeligheten": customer.really_is,
        "mål": customer.goal,
        "vet": customer.knows,
        "taktikker": customer.tactics,
    }
    return (
        load_prompt("customer_frame.md").strip()
        + "\n\nDin rolle:\n"
        + json.dumps(persona, ensure_ascii=False, indent=2)
    )
