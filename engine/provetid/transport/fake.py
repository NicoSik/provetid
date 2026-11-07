"""A transport that never calls Claude. Tests, CI and UI work use it."""

from dataclasses import dataclass

from pydantic import BaseModel

from provetid.transport.base import CallResult, Role, TransportError


@dataclass(frozen=True)
class RecordedCall:
    role: Role
    system_prompt: str
    user_input: str


class FakeTransport:
    def __init__(self, script: dict[Role, list[BaseModel | dict | TransportError]]) -> None:
        self._script = {role: list(items) for role, items in script.items()}
        self.calls: list[RecordedCall] = []

    async def call(
        self, role: Role, system_prompt: str, user_input: str, output: type[BaseModel]
    ) -> CallResult:
        self.calls.append(RecordedCall(role, system_prompt, user_input))
        queue = self._script.get(role)
        assert queue, f"FakeTransport script has no more outputs for role {role!r}"
        item = queue.pop(0)
        if isinstance(item, TransportError):
            raise item
        if isinstance(item, dict):
            item = output.model_validate(item)
        return CallResult(data=item, cost_usd=0.0)
