"""«Si opp»: `POST /api/dismiss` sets or clears the flag, `GET /api/dismiss` reads it."""

import asyncio
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, StrictBool

from provetid import dismiss
from provetid.config import Settings

router = APIRouter(prefix="/api/dismiss")


class DismissRequest(BaseModel):
    dismissed: StrictBool


async def _state(request: Request) -> dict[str, Any]:
    settings: Settings = request.app.state.settings
    figures = await asyncio.to_thread(dismiss.summary, settings.data_dir / "runs")
    return {
        "dismissed": dismiss.is_dismissed(),
        "summary": figures,
        "closed_message": dismiss.CLOSED_MESSAGE,
    }


@router.get("")
async def get_dismissed(request: Request) -> dict[str, Any]:
    return await _state(request)


@router.post("")
async def set_dismissed(body: DismissRequest, request: Request) -> dict[str, Any]:
    dismiss.set_dismissed(body.dismissed)
    return await _state(request)
