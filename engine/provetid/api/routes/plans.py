"""Read and save a test plan."""

from fastapi import APIRouter, HTTPException, Request

from provetid.config import Settings
from provetid.plan.models import TestPlan
from provetid.plan.store import PlanNotFound, load_plan, save_plan

router = APIRouter(prefix="/api/plans")


@router.get("/{plan_id}")
async def get_plan(plan_id: str, request: Request) -> TestPlan:
    settings: Settings = request.app.state.settings
    try:
        return load_plan(plan_id, data_dir=settings.data_dir)
    except PlanNotFound:
        raise HTTPException(status_code=404, detail="Fant ikke testplanen.") from None


@router.put("/{plan_id}")
async def put_plan(plan_id: str, plan: TestPlan, request: Request) -> TestPlan:
    settings: Settings = request.app.state.settings
    if plan.id != plan_id:
        raise HTTPException(status_code=422, detail="Planens id stemmer ikke med adressen.")
    try:
        load_plan(plan_id, data_dir=settings.data_dir)
    except PlanNotFound:
        raise HTTPException(status_code=404, detail="Fant ikke testplanen.") from None
    save_plan(plan, data_dir=settings.data_dir)
    return plan
