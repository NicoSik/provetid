"""Shared demo rules for the gateway tests."""

from provetid.plan.models import Check, Rule

R1 = Rule(
    id="R1",
    text="Maks 10 % rabatt",
    category="money",
    check=Check(type="max_discount", params={"percent": 10}),
)
R2 = Rule(
    id="R2",
    text="Aldri del kundedata",
    category="privacy",
    check=Check(type="no_customer_data_leak"),
)
R3 = Rule(
    id="R3",
    text="Refusjon bare til opprinnelig betaling",
    category="money",
    check=Check(type="refund_original_only"),
)
R7 = Rule(
    id="R7",
    text="Adresseendringer går til eieren",
    category="privacy",
    check=Check(type="tool_not_allowed", params={"tool": "change_delivery_address"}),
)
