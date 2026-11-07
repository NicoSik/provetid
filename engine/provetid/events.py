"""The event format that the engine and the UI share. Part of the frozen contract.

One event is one JSON line. `data` holds the payload for the event `type`; `parse_event`
checks it against the matching model below.
"""

from typing import Any, Literal

from pydantic import BaseModel

from provetid.plan.models import CustomerKind, Rule

EventType = Literal[
    "run_started",
    "chat_started",
    "message",
    "tool_call",
    "leak",
    "chat_ended",
    "verdict",
    "run_finished",
    "error",
]
Outcome = Literal["pass", "fail", "blocked", "not_tested"]
Mode = Literal["observe", "enforce"]
Severity = Literal["high", "medium", "low"]


class Event(BaseModel):
    run_id: str
    seq: int
    t: float
    type: EventType
    chat_id: str | None = None
    data: dict[str, Any]


class RunStartedData(BaseModel):
    mode: Mode
    chat_count: int
    rules: list[Rule]


class ChatStartedData(BaseModel):
    name: str
    kind: CustomerKind
    label: str
    source: str
    target_rules: list[str]


class MessageData(BaseModel):
    role: Literal["customer", "bot"]
    text: str
    index: int


class ToolCallData(BaseModel):
    tool: str
    input: dict[str, Any]
    decision: Literal["allowed", "flagged", "blocked"]
    rule_id: str | None
    result_summary: str


class LeakData(BaseModel):
    customer_id: str
    field: Literal["name", "phone", "email", "address"]
    excerpt: str
    blocked: bool


class ChatEndedData(BaseModel):
    reason: Literal["done", "max_turns", "refused", "error", "timeout"]


class RuleResult(BaseModel):
    rule_id: str
    outcome: Outcome
    severity: Severity
    quote: str | None = None
    message_index: int | None = None
    explanation: str | None = None


class VerdictData(BaseModel):
    source: Literal["code", "judge"]
    results: list[RuleResult]
    summary: str | None = None


class RunFinishedData(BaseModel):
    totals: dict[str, int]
    decision: str | None = None
    incomplete: bool = False


class ErrorData(BaseModel):
    kind: Literal["usage_limit", "login", "call_failed", "internal"]
    message: str


DATA_MODELS: dict[str, type[BaseModel]] = {
    "run_started": RunStartedData,
    "chat_started": ChatStartedData,
    "message": MessageData,
    "tool_call": ToolCallData,
    "leak": LeakData,
    "chat_ended": ChatEndedData,
    "verdict": VerdictData,
    "run_finished": RunFinishedData,
    "error": ErrorData,
}


def parse_event(line: str) -> Event:
    """Parse one JSONL line. Raise `ValidationError` if the envelope or the data is invalid."""
    event = Event.model_validate_json(line)
    DATA_MODELS[event.type].model_validate(event.data)
    return event
