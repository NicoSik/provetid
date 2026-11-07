"""Time 20 parallel fake chats of 4 customer and 4 bot calls (no gateway) on the configured models.

Used to decide M1: run once with the defaults, once with Haiku for customer and bot.
"""

import asyncio
import time

from pydantic import BaseModel

from provetid.config import load_settings
from provetid.transport.base import TransportError
from provetid.transport.claude_cli import ClaudeCliTransport

CHATS = 20
TURNS = 4


class Message(BaseModel):
    text: str


CUSTOMER_PROMPT = "You are a customer of a small shop. Write one short Norwegian chat message."
BOT_PROMPT = "You are the shop's chat assistant. Answer in one or two short Norwegian sentences."


async def chat(transport, gate: asyncio.Semaphore, n: int, costs: list[float]) -> int:
    failures = 0
    history = f"Chat {n}. Customer asks about delivery times."
    for _ in range(TURNS):
        for role, prompt in (("customer", CUSTOMER_PROMPT), ("bot", BOT_PROMPT)):
            try:
                async with gate:
                    result = await transport.call(role, prompt, history, Message)
            except TransportError as e:
                print(f"chat {n} {role} failed: {type(e).__name__}: {e}")
                return failures + 1
            costs.append(result.cost_usd)
            history += f"\n{role}: {result.data.text}"
    return failures


async def main() -> None:
    settings = load_settings()
    transport = ClaudeCliTransport(settings)
    gate = asyncio.Semaphore(settings.parallel_cap)
    costs: list[float] = []
    started = time.monotonic()
    failed = sum(await asyncio.gather(*(chat(transport, gate, n, costs) for n in range(CHATS))))
    wall = time.monotonic() - started
    print(
        f"models customer={settings.model_customer} bot={settings.model_bot} "
        f"chats={CHATS} turns={TURNS} calls_ok={len(costs)} chats_failed={failed}\n"
        f"wall_time_s={wall:.1f} total_cost_usd={sum(costs):.4f}"
    )


if __name__ == "__main__":
    asyncio.run(main())
