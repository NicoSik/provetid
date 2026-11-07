"""The FastAPI app. `uvicorn provetid.api.app:app` serves it."""

import asyncio
import importlib
import pkgutil
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from provetid.api import routes
from provetid.config import Settings, load_settings
from provetid.eventlog import EventLog
from provetid.gateway.actions import Action, BotReply
from provetid.plan.models import CustomerReply
from provetid.transport.base import Transport
from provetid.transport.claude_cli import ClaudeCliTransport
from provetid.transport.fake import FakeTransport
from provetid.verdict.judge import JudgeOutput

UI_DIST = Path(__file__).resolve().parents[3] / "ui" / "dist"
_DEFAULT_ROUNDS = 100


def default_fake_transport() -> FakeTransport:
    """A small script, so `make dev` produces a run. It is long enough for 20 chats."""
    look = Action(tool="lookup_order", args={"order_id": "1043"})
    bot = []
    customer = []
    for _ in range(_DEFAULT_ROUNDS):
        bot += [
            BotReply(reply="La meg sjekke bestillingen din.", actions=[look]),
            BotReply(reply="Hei! Bestillingen din er på vei. Kan jeg hjelpe med noe mer?"),
        ]
        customer += [
            CustomerReply(message="Hvor lang tid tar det?", end_chat=False),
            CustomerReply(message="Takk for hjelpen!", end_chat=True),
        ]
    # The fake judge answers nothing, so its rules show as not tested. It never fakes a pass.
    judge = [JudgeOutput(results=[], summary="") for _ in range(_DEFAULT_ROUNDS)]
    return FakeTransport({"bot": bot, "customer": customer, "judge": judge})


def create_app(settings: Settings, transport: Transport | None = None) -> FastAPI:
    factory: Callable[[], Transport]
    if transport is not None:
        factory = lambda: transport  # noqa: E731
    elif settings.transport == "claude":
        factory = lambda: ClaudeCliTransport(settings)  # noqa: E731
    else:
        factory = default_fake_transport  # a fresh script for every run

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        tasks = list(app.state.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    app = FastAPI(title="Prøvetid", lifespan=lifespan)
    app.state.settings = settings
    app.state.transport_factory = factory
    app.state.tasks = set()
    app.state.live_logs = dict[str, EventLog]()

    for module_info in pkgutil.iter_modules(routes.__path__):
        module = importlib.import_module(f"{routes.__name__}.{module_info.name}")
        router = getattr(module, "router", None)
        if router is not None:
            app.include_router(router)

    if UI_DIST.is_dir():
        app.mount("/", StaticFiles(directory=UI_DIST, html=True), name="ui")
    return app


app = create_app(load_settings())
