"""Build, read and save a test plan."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from provetid.config import Settings
from provetid.plan.builder import build_plan
from provetid.plan.models import TestPlan
from provetid.plan.store import PlanNotFound, load_plan, save_plan
from provetid.transport.base import LoginFailed, Refused, TransportError, UsageLimitReached

MAX_JOB_AD = 10_000


class BuildRequest(BaseModel):
    job_ad: str


router = APIRouter(prefix="/api/plans")


@router.post("")
async def post_plan(body: BuildRequest, request: Request) -> TestPlan:
    """«Lag regler»: build a plan from any job ad and save it, so it can be approved and run."""
    state = request.app.state
    settings: Settings = state.settings
    if not body.job_ad.strip() or len(body.job_ad) > MAX_JOB_AD:
        raise HTTPException(status_code=422, detail="Annonsen er tom eller for lang.")
    try:
        plan = await build_plan(body.job_ad, state.transport_factory(), data_dir=settings.data_dir)
    except PlanNotFound:
        raise HTTPException(status_code=409, detail="Demo-planen mangler.") from None
    except (Refused, ValueError):
        raise HTTPException(
            status_code=422,
            detail="Klarte ikke å lage regler fra denne annonsen. Prøv å skrive den om.",
        ) from None
    except LoginFailed:
        raise HTTPException(status_code=503, detail="Claude Code er ikke logget inn.") from None
    except UsageLimitReached:
        raise HTTPException(
            status_code=503, detail="Bruksgrensen er nådd. Prøv igjen senere."
        ) from None
    except TransportError:
        raise HTTPException(
            status_code=503, detail="Modellen svarte ikke. Prøv igjen om litt."
        ) from None
    save_plan(plan, data_dir=settings.data_dir)
    return plan


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
