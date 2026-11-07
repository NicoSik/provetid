"""The owner's limits («Signeringsrett»)."""

from fastapi import APIRouter, HTTPException, Request

from provetid.config import Settings
from provetid.gateway.limits import Limits, limits_from_rules
from provetid.limits_store import load_limits, save_limits
from provetid.plan.store import PlanNotFound, load_plan

router = APIRouter(prefix="/api/limits")

DEMO_PLAN_ID = "demo"


@router.get("")
async def get_limits(request: Request, plan_id: str = DEMO_PLAN_ID) -> Limits:
    """The saved limits, or else the limits that follow from the rules of the plan asked for."""
    settings: Settings = request.app.state.settings
    try:
        rules = load_plan(plan_id, data_dir=settings.data_dir).rules
    except PlanNotFound:
        # A missing demo plan is an empty install. Any other plan id was asked for by name.
        if plan_id != DEMO_PLAN_ID:
            raise HTTPException(status_code=404, detail="Fant ikke testplanen.") from None
        rules = None
    saved = load_limits(settings.data_dir)
    if saved is not None:
        return saved
    return limits_from_rules(rules) if rules is not None else Limits()


@router.put("")
async def put_limits(limits: Limits, request: Request) -> Limits:
    settings: Settings = request.app.state.settings
    save_limits(limits, settings.data_dir)
    return limits
