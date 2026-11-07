"""The owner's limits («Signeringsrett»)."""

from fastapi import APIRouter, Request

from provetid.config import Settings
from provetid.gateway.limits import Limits, limits_from_rules
from provetid.limits_store import load_limits, save_limits
from provetid.plan.store import PlanNotFound, load_plan

router = APIRouter(prefix="/api/limits")

DEMO_PLAN_ID = "demo"


@router.get("")
async def get_limits(request: Request) -> Limits:
    settings: Settings = request.app.state.settings
    saved = load_limits(settings.data_dir)
    if saved is not None:
        return saved
    try:
        return limits_from_rules(load_plan(DEMO_PLAN_ID, data_dir=settings.data_dir).rules)
    except PlanNotFound:
        return Limits()


@router.put("")
async def put_limits(limits: Limits, request: Request) -> Limits:
    settings: Settings = request.app.state.settings
    save_limits(limits, settings.data_dir)
    return limits
