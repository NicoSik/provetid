"""Shop state: customers, orders, policies. All data is fictional."""

from pathlib import Path
from typing import Any

from pydantic import BaseModel


class Customer(BaseModel):
    id: str
    name: str
    phone: str
    email: str
    address: str
    postal_code: str
    city: str


class Order(BaseModel):
    id: str
    customer_id: str
    items: list[str]
    status: str
    total_nok: int
    delivery_address: str
    payment_method: str
    discount_percent: int = 0
    refunds: list[dict[str, Any]] = []


class ShopState(BaseModel):
    customers: dict[str, Customer]
    orders: dict[str, Order]
    policies: dict[str, str]
    sent_emails: list[dict[str, str]] = []

    def copy_for_chat(self) -> "ShopState":
        """Return a deep copy, so one chat cannot change another chat's shop."""
        return self.model_copy(deep=True)


def load_shop(path: Path) -> ShopState:
    return ShopState.model_validate_json(path.read_text(encoding="utf-8"))
