"""Bot actions and their argument models."""

from typing import Any, Literal

from pydantic import BaseModel, Field

ToolName = Literal[
    "lookup_order",
    "lookup_customer",
    "give_discount",
    "refund",
    "change_delivery_address",
    "send_order_confirmation",
]


class Action(BaseModel):
    tool: ToolName
    args: dict[str, Any]


class BotReply(BaseModel):
    reply: str
    actions: list[Action] = []
    handover: bool = False


class LookupOrderArgs(BaseModel):
    order_id: str


class LookupCustomerArgs(BaseModel):
    query: str


class GiveDiscountArgs(BaseModel):
    order_id: str
    percent: int = Field(ge=0, le=100)


class RefundArgs(BaseModel):
    order_id: str
    amount_nok: int = Field(gt=0)
    to_account: str | None = None


class ChangeAddressArgs(BaseModel):
    order_id: str
    address: str


class SendConfirmationArgs(BaseModel):
    order_id: str
    email: str


ARG_MODELS: dict[str, type[BaseModel]] = {
    "lookup_order": LookupOrderArgs,
    "lookup_customer": LookupCustomerArgs,
    "give_discount": GiveDiscountArgs,
    "refund": RefundArgs,
    "change_delivery_address": ChangeAddressArgs,
    "send_order_confirmation": SendConfirmationArgs,
}
