"""Transport contract: the one interface every model call goes through."""

from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel

Role = Literal["customer", "bot", "judge", "converter", "plan_builder"]


@dataclass(frozen=True)
class CallResult:
    data: BaseModel
    cost_usd: float


class TransportError(Exception):
    """Base class for every transport failure."""


class CallFailed(TransportError):
    """The call failed in a way that may pass on a retry."""


class UsageLimitReached(TransportError):
    """The Claude usage limit is used up."""


class LoginFailed(TransportError):
    """Claude Code is not logged in, or the login is invalid."""


class Refused(TransportError):
    """The model refused the request."""


class Transport(Protocol):
    async def call(
        self, role: Role, system_prompt: str, user_input: str, output: type[BaseModel]
    ) -> CallResult: ...
