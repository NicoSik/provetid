"""The six shop tools. Each runs on one chat's own shop copy."""

from typing import Any

from provetid.gateway.actions import (
    Action,
    ChangeAddressArgs,
    GiveDiscountArgs,
    LookupCustomerArgs,
    LookupOrderArgs,
    RefundArgs,
    SendConfirmationArgs,
)
from provetid.shop.data import Customer, ShopState
from provetid.shop.leaks import normalize

_HIDDEN_CUSTOMER_FIELDS = {"phone", "address", "postal_code", "city"}


def _phone_digits(text: str) -> str:
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits.removeprefix("47") if len(digits) > 8 else digits


def _matches(customer: Customer, query: str) -> bool:
    q = query.strip()
    if not q:
        return False
    if q.lower() == customer.id.lower():
        return True
    qn = normalize(q)
    if qn and (qn == normalize(customer.email) or qn in normalize(customer.name)):
        return True
    qp = _phone_digits(q)
    return len(qp) >= 5 and qp == _phone_digits(customer.phone)


def run_tool(
    action: Action, shop: ShopState, hide_address_phone: bool
) -> tuple[dict[str, Any] | str, str]:
    """Run a validated action. Return the result and a short Norwegian summary."""
    args = action.args
    if action.tool == "lookup_customer":
        q = LookupCustomerArgs(**args).query
        for customer in shop.customers.values():
            if _matches(customer, q):
                data = customer.model_dump()
                if hide_address_phone:
                    data = {k: v for k, v in data.items() if k not in _HIDDEN_CUSTOMER_FIELDS}
                return data, f"Fant kunde {customer.id}"
        return "Fant ingen kunde.", "Ingen kunde funnet"

    order_id = _order_id(action)
    order = shop.orders.get(order_id)
    if order is None:
        return f"Fant ikke ordre {order_id}.", f"Ordre {order_id} finnes ikke"

    if action.tool == "lookup_order":
        data = order.model_dump()
        if hide_address_phone:
            data.pop("delivery_address")
        return data, f"Slo opp ordre {order_id}"
    if action.tool == "give_discount":
        percent = GiveDiscountArgs(**args).percent
        order.discount_percent = percent
        return {"order_id": order_id, "discount_percent": percent}, (
            f"Ga {percent} % rabatt på ordre {order_id}"
        )
    if action.tool == "refund":
        r = RefundArgs(**args)
        order.refunds.append({"amount_nok": r.amount_nok, "to_account": r.to_account})
        target = "til annen konto" if r.to_account else "til opprinnelig betaling"
        return {"order_id": order_id, "refunded_nok": r.amount_nok}, (
            f"Refunderte {r.amount_nok} kr {target} for ordre {order_id}"
        )
    if action.tool == "change_delivery_address":
        order.delivery_address = ChangeAddressArgs(**args).address
        return {"order_id": order_id, "delivery_address": order.delivery_address}, (
            f"Endret leveringsadresse for ordre {order_id}"
        )
    email = SendConfirmationArgs(**args).email
    shop.sent_emails.append({"order_id": order_id, "email": email})
    return {"order_id": order_id, "sent_to": email}, f"Sendte ordrebekreftelse for ordre {order_id}"


def _order_id(action: Action) -> str:
    if action.tool == "lookup_order":
        return LookupOrderArgs(**action.args).order_id
    return str(action.args["order_id"])
