"""Make one real call per role through the Claude transport and print each result.

Every role uses its own model and effort from the settings, so this also checks that each
configured model answers.
"""

import asyncio
import time

from pydantic import BaseModel

from provetid.config import load_settings
from provetid.transport.base import Role, TransportError
from provetid.transport.claude_cli import ClaudeCliTransport, claude_version

ROLES: tuple[Role, ...] = ("customer", "bot", "judge", "converter", "plan_builder")


class Pong(BaseModel):
    reply: str


async def ping(transport: ClaudeCliTransport, role: Role) -> tuple[Role, str, float, float]:
    started = time.monotonic()
    try:
        result = await transport.call(
            role, "You answer in one short Norwegian sentence.", "Si hei.", Pong
        )
        return role, result.data.reply, result.cost_usd, time.monotonic() - started
    except TransportError as error:
        return role, f"FEIL: {type(error).__name__}: {error}", 0.0, time.monotonic() - started


async def main() -> int:
    settings = load_settings()
    transport = ClaudeCliTransport(settings)
    print(f"claude={claude_version()}")
    results = await asyncio.gather(*(ping(transport, role) for role in ROLES))
    for role, reply, cost, seconds in results:
        model = getattr(settings, f"model_{role}")
        print(f"{role:13} model={model:7} {seconds:5.1f}s cost_usd={cost:.4f}  {reply}")
    return 1 if any(reply.startswith("FEIL") for _, reply, _, _ in results) else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
