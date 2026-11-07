"""«Send inn svindel»: `POST /api/scams` turns a pasted scam message into a one-chat test.

The raw text is cleaned in code first (REQ-6.1). It is never stored, never logged and never
sent to a model (REQ-6.6). No code here opens a link or contacts anyone (REQ-6.4, REQ-6.5).
"""

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from provetid.config import Settings
from provetid.gateway.limits import limits_from_rules
from provetid.plan.models import FakeCustomer
from provetid.plan.store import PlanNotFound, load_plan
from provetid.runner.launch import launch_run, new_run_id
from provetid.scam.convert import convert_scam
from provetid.scam.redact import redact
from provetid.transport.base import Refused, TransportError

router = APIRouter(prefix="/api/scams")

MAX_LENGTH = 5000
DEMO_PLAN = "demo"
BAD_TEXT = "Meldingen er tom eller for lang."


class ScamResponse(BaseModel):
    clean_text: str
    customer: FakeCustomer
    run_id: str


async def _text_from(request: Request) -> str:
    """Read `{"text": "..."}` by hand. FastAPI's own validation error would echo the text."""
    try:
        body: Any = await request.json()
    except ValueError:
        body = None
    text = body.get("text") if isinstance(body, dict) else None
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_LENGTH:
        raise HTTPException(status_code=422, detail=BAD_TEXT)
    return text


@router.post("")
async def submit_scam(request: Request) -> ScamResponse:
    state = request.app.state
    settings: Settings = state.settings
    # From here on only the cleaned text is used. (Starlette keeps the raw body on the request
    # until the request ends; nothing below reads it.)
    clean = redact(await _text_from(request)).text
    try:
        plan = load_plan(DEMO_PLAN, data_dir=settings.data_dir)
    except PlanNotFound:
        raise HTTPException(status_code=409, detail="Demo-planen mangler.") from None
    try:
        conversion = await convert_scam(
            clean, state.transport_factory(), rules=plan.rules, data_dir=settings.data_dir
        )
    except Refused:
        raise HTTPException(
            status_code=422,
            detail="Klarte ikke å lage en test av denne meldingen. Prøv en annen.",
        ) from None
    except TransportError:
        raise HTTPException(
            status_code=503, detail="Modellen svarte ikke. Prøv igjen om litt."
        ) from None

    # Save first, so a failed write never leaves a run going that nothing points to.
    run_id = new_run_id()
    folder = settings.data_dir / "scams" / "submitted"
    folder.mkdir(parents=True, exist_ok=True)
    record = {
        "id": run_id,
        "created_at": datetime.now(UTC).isoformat(),
        "clean_text": conversion.text,
        "scam_type": conversion.scam_type,
        "customer": conversion.customer.model_dump(mode="json"),
        "run_id": run_id,
    }
    (folder / f"{run_id}.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    scam_plan = plan.model_copy(
        update={"id": f"{plan.id}-svindel", "customers": [conversion.customer]}
    )
    launch_run(state, scam_plan, "observe", limits_from_rules(plan.rules), run_id=run_id)
    return ScamResponse(clean_text=conversion.text, customer=conversion.customer, run_id=run_id)
