"""One run: all chats of a plan in parallel, then the verdict steps, as events."""

import asyncio
from collections.abc import Awaitable, Callable

from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import (
    ChatEndedData,
    ErrorData,
    Mode,
    RunStartedData,
    VerdictData,
)
from provetid.gateway.gateway import Gateway
from provetid.gateway.limits import Limits
from provetid.plan.models import FakeCustomer, TestPlan
from provetid.runner.chat import ChatContext, ChatRecord, run_chat_into
from provetid.shop.data import load_shop
from provetid.transport.base import LoginFailed, Transport, UsageLimitReached
from provetid.verdict.decision import summarize

VerdictStep = Callable[[TestPlan, FakeCustomer, ChatRecord], Awaitable[VerdictData]]


async def run_plan(
    plan: TestPlan,
    mode: Mode,
    limits: Limits,
    transport: Transport,
    settings: Settings,
    log: EventLog,
    steps: list[VerdictStep],
) -> None:
    stopped = False
    log.append(
        "run_started",
        RunStartedData(mode=mode, chat_count=len(plan.customers), rules=plan.rules),
    )
    try:
        shop = load_shop(settings.data_dir / "shop.json")
        gateway = Gateway(plan.rules, limits, mode)
        bot_instructions = "\n".join(limits.extra_instructions)
        gate = asyncio.Semaphore(max(settings.parallel_cap, 1))
        tasks: list[asyncio.Task[None]] = []

        def stop_run(kind: str, message: str) -> None:
            nonlocal stopped
            if not stopped:
                stopped = True
                log.append("error", ErrorData.model_validate({"kind": kind, "message": message}))
            for task in tasks:
                if task is not asyncio.current_task():
                    task.cancel()

        async def one_chat(index: int, customer: FakeCustomer) -> None:
            chat_id = f"chat-{index + 1}"
            record = ChatRecord(customer_id=customer.id)
            started = False

            def close(reason: str) -> None:
                if started and not record.end_reason:
                    record.end_reason = reason
                    log.append(
                        "chat_ended", ChatEndedData.model_validate({"reason": reason}), chat_id
                    )

            async with gate:
                if stopped:
                    return
                ctx = ChatContext(
                    transport=transport,
                    gateway=gateway,
                    shop=shop.copy_for_chat(),
                    log=log,
                    settings=settings,
                    bot_instructions=bot_instructions,
                    rules=plan.rules,
                )
                try:
                    started = True
                    watchdog = asyncio.timeout(settings.chat_timeout_s)
                    try:
                        async with watchdog:
                            await run_chat_into(customer, chat_id, ctx, record)
                    except TimeoutError:
                        if not watchdog.expired():
                            raise
                        close("timeout")
                    for step in steps:
                        verdict = await step(plan, customer, record)
                        log.append("verdict", verdict, chat_id)
                except UsageLimitReached as e:
                    close("error")
                    stop_run("usage_limit", str(e) or "Bruksgrensen er nådd.")
                except LoginFailed as e:
                    close("error")
                    stop_run("login", str(e) or "Claude Code er ikke logget inn.")
                except asyncio.CancelledError:
                    close("error")
                    raise
                except Exception as e:
                    close("error")
                    log.append(
                        "error",
                        ErrorData.model_validate(
                            {"kind": "internal", "message": f"{type(e).__name__}: {e}"}
                        ),
                        chat_id,
                    )

        tasks.extend(
            asyncio.create_task(one_chat(i, customer)) for i, customer in enumerate(plan.customers)
        )
        await asyncio.gather(*tasks, return_exceptions=True)
    except asyncio.CancelledError:
        stopped = True
        raise
    except Exception as e:
        stopped = True
        log.append(
            "error",
            ErrorData.model_validate({"kind": "internal", "message": f"{type(e).__name__}: {e}"}),
        )
    finally:
        log.append("run_finished", summarize(log.read(), stopped=stopped))
