"""Report whether the demo can run: `GET /api/health`."""

from typing import Any

from fastapi import APIRouter, Request

from provetid import health
from provetid.config import Settings
from provetid.transport.claude_cli import ClaudeCliTransport

router = APIRouter(prefix="/api/health")


@router.get("")
async def get_health(request: Request) -> dict[str, Any]:
    state = request.app.state
    settings: Settings = state.settings
    claude = getattr(state, "claude_check", None)
    if claude is None:  # one per app, so the answer stays cached between requests
        # Check Claude only when runs really use it, not when a fake transport was injected.
        uses_claude = isinstance(state.transport_factory(), ClaudeCliTransport)
        claude = state.claude_check = health.ClaudeCheck(settings, enabled=uses_claude)
    return await health.check(settings, claude)
