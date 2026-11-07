"""One chat: a fake customer talks with the shop's bot until one side ends it."""

import json
from dataclasses import dataclass

from pydantic import BaseModel

from provetid.config import Settings
from provetid.eventlog import EventLog
from provetid.events import ChatEndedData, ChatStartedData, LeakData, MessageData, ToolCallData
from provetid.gateway.actions import BotReply
from provetid.gateway.gateway import Gateway
from provetid.plan.models import CustomerReply, FakeCustomer, Rule
from provetid.runner import prompts
from provetid.shop.data import ShopState
from provetid.transport.base import CallFailed, Refused, Transport

MAX_BOT_ROUNDS = 3


class ChatRecord(BaseModel):
    customer_id: str
    messages: list[MessageData] = []
    tool_calls: list[ToolCallData] = []
    leaks: list[LeakData] = []
    # The index of the message that follows each tool call and each leak. The checks quote it.
    call_positions: list[int] = []
    leak_positions: list[int] = []
    # Whether the bot really handed the chat over. The event format does not carry this.
    handed_over: bool = False
    end_reason: str = ""


@dataclass
class ChatContext:
    transport: Transport
    gateway: Gateway
    shop: ShopState
    log: EventLog
    settings: Settings
    bot_instructions: str
    rules: list[Rule]


async def run_chat(customer: FakeCustomer, chat_id: str, ctx: ChatContext) -> ChatRecord:
    record = ChatRecord(customer_id=customer.id)
    await run_chat_into(customer, chat_id, ctx, record)
    return record


def _end(ctx: ChatContext, chat_id: str, record: ChatRecord, reason: str) -> None:
    record.end_reason = reason
    ctx.log.append("chat_ended", ChatEndedData.model_validate({"reason": reason}), chat_id)


def _say(ctx: ChatContext, chat_id: str, record: ChatRecord, role: str, text: str) -> None:
    message = MessageData.model_validate(
        {"role": role, "text": text, "index": len(record.messages)}
    )
    record.messages.append(message)
    ctx.log.append("message", message, chat_id)


async def run_chat_into(
    customer: FakeCustomer, chat_id: str, ctx: ChatContext, record: ChatRecord
) -> None:
    """Run the chat and fill `record` as it goes, so a caller can read it after a timeout.

    `UsageLimitReached` and `LoginFailed` are not caught here: they stop the whole run.
    """
    ctx.log.append(
        "chat_started",
        ChatStartedData(
            name=customer.name,
            kind=customer.kind,
            label=customer.label,
            source=customer.source,
            target_rules=customer.target_rules,
        ),
        chat_id,
    )
    public: list[str] = []  # what both sides said
    bot_view: list[str] = []  # the same, plus the tool results that only the bot sees
    bot_system = prompts.bot_system_prompt(ctx.rules, ctx.bot_instructions)
    customer_system = prompts.customer_system_prompt(customer)

    def customer_says(text: str) -> None:
        _say(ctx, chat_id, record, "customer", text)
        public.append(f"Kunde: {text}")
        bot_view.append(f"Kunde: {text}")

    customer_says(customer.opening)
    customer_count = 1
    try:
        while True:
            reply = await _bot_turn(customer, chat_id, ctx, record, bot_system, public, bot_view)
            if reply.handover:
                record.handed_over = True
                _end(ctx, chat_id, record, "done")
                return
            if customer_count >= customer.max_messages:
                _end(ctx, chat_id, record, "max_turns")
                return
            result = await ctx.transport.call(
                "customer", customer_system, "\n".join(public), CustomerReply
            )
            answer = result.data
            assert isinstance(answer, CustomerReply)
            customer_says(answer.message)
            customer_count += 1
            if answer.end_chat:
                _end(ctx, chat_id, record, "done")
                return
    except Refused:
        _end(ctx, chat_id, record, "refused")
    except CallFailed:
        _end(ctx, chat_id, record, "error")


async def _bot_turn(
    customer: FakeCustomer,
    chat_id: str,
    ctx: ChatContext,
    record: ChatRecord,
    bot_system: str,
    public: list[str],
    bot_view: list[str],
) -> BotReply:
    """Up to three bot rounds, then the last reply goes through the leak filter to the customer."""
    pending: list[str] = []  # action results of this turn
    reply = BotReply(reply="")
    for _ in range(MAX_BOT_ROUNDS):
        user_input = "\n".join([*bot_view, *pending])
        result = await ctx.transport.call("bot", bot_system, user_input, BotReply)
        reply = result.data
        assert isinstance(reply, BotReply)
        if not reply.actions:
            break
        for action in reply.actions:
            decision = ctx.gateway.apply(action, ctx.shop)
            call = ToolCallData(
                tool=action.tool,
                input=action.args,
                decision=decision.decision,
                rule_id=decision.rule_id,
                result_summary=decision.result_summary,
            )
            record.tool_calls.append(call)
            record.call_positions.append(len(record.messages))
            ctx.log.append("tool_call", call, chat_id)
            outcome = json.dumps(decision.result, ensure_ascii=False)
            pending.append(f"Verktøyresultat {action.tool}: {outcome}")
    filtered = ctx.gateway.filter_reply(reply.reply, ctx.shop, customer.really_is)
    for hit in filtered.leaks:
        leak = LeakData(
            customer_id=hit.customer_id,
            field=hit.field,
            excerpt=hit.excerpt,
            blocked=filtered.blocked,
        )
        record.leaks.append(leak)
        record.leak_positions.append(len(record.messages))
        ctx.log.append("leak", leak, chat_id)
    _say(ctx, chat_id, record, "bot", filtered.text)
    public.append(f"Bot: {filtered.text}")
    bot_view.extend([*pending, f"Bot: {filtered.text}"])
    return reply
