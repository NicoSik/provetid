"""Make one real call through the Claude transport and print the JSON."""

import asyncio
import time

from pydantic import BaseModel

from provetid.config import load_settings
from provetid.transport.claude_cli import ClaudeCliTransport, claude_version


class Pong(BaseModel):
    reply: str


async def main() -> None:
    settings = load_settings()
    transport = ClaudeCliTransport(settings)
    started = time.monotonic()
    result = await transport.call(
        "bot", "You answer in one short Norwegian sentence.", "Si hei.", Pong
    )
    print(
        result.data.model_dump_json(indent=2),
        f"\ncost_usd={result.cost_usd}",
        f"model={settings.model_bot} claude={claude_version()}",
        f"seconds={time.monotonic() - started:.1f}",
    )


if __name__ == "__main__":
    asyncio.run(main())
