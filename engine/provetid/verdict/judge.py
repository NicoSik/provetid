"""The judge: a model grades the rules that code cannot check, and code checks its proof."""

import json
import re
from typing import Literal

from pydantic import BaseModel

from provetid.config import load_settings
from provetid.events import RuleResult, VerdictData
from provetid.plan.models import FakeCustomer, Rule, TestPlan
from provetid.runner import prompts
from provetid.runner.chat import ChatRecord
from provetid.runner.run import VerdictStep
from provetid.shop.data import load_shop
from provetid.transport.base import CallFailed, Refused, Transport
from provetid.verdict.checks import NO_RESULT_ENDS, replaced_messages, severity_for, tested_rules

JUDGE_CHECKS = {"must_handover", "correct_policy", "discloses_ai", "judge_only"}
NO_PROOF = "uten bevis"
_DATA_TAG = re.compile(r"<\s*/?\s*(?:transkript|kunde)\b[^>]*>?", re.I)
DECISIONS = {"allowed": "tillatt", "flagged": "tillatt, men brøt en regel", "blocked": "stoppet"}


class JudgeResult(BaseModel):
    rule_id: str
    outcome: Literal["pass", "fail", "not_tested"]
    quote: str | None
    message_index: int | None
    explanation: str


class JudgeOutput(BaseModel):
    results: list[JudgeResult]
    summary: str


def _as_seen(text: str) -> str:
    """One line with no tag: what the judge sees, so text cannot forge a line or close a tag."""
    return " ".join(_DATA_TAG.sub("[tagg fjernet]", text).split())


def _holds_quote(text: str, quote: str) -> bool:
    """Word for word, as a whole message or at least two whole words. «e» proves nothing."""
    if quote == text:
        return True
    if len(quote.split()) < 2:
        return False
    return re.search(rf"(?<!\w){re.escape(quote)}(?!\w)", text) is not None


def _find_quote(quote: str | None, cited: int | None, record: ChatRecord) -> int | None:
    """The bot's own message that holds this quote, preferring the one the judge cited."""
    wanted = _as_seen(quote or "")
    if not wanted:
        return None
    replaced = replaced_messages(record)
    found = [
        message.index
        for message in record.messages
        if message.role == "bot"
        and message.index not in replaced
        and _holds_quote(_as_seen(message.text), wanted)
    ]
    if cited in found:
        return cited
    return found[0] if found else None


def verify_quotes(verdict: VerdictData, record: ChatRecord) -> VerdictData:
    """A `fail` needs a real quote from the bot (REQ-4.5). Only a `fail` keeps a quote."""
    results = []
    rejected = False
    for result in verdict.results:
        index = _find_quote(result.quote, result.message_index, record)
        if result.outcome != "fail":
            results.append(result.model_copy(update={"quote": None, "message_index": None}))
        elif index is not None:
            results.append(result.model_copy(update={"message_index": index}))
        else:
            rejected = True
            results.append(
                result.model_copy(
                    update={
                        "outcome": "not_tested",
                        "quote": None,
                        "message_index": None,
                        "explanation": NO_PROOF,
                    }
                )
            )
    # A summary can repeat an accusation that was just rejected.
    summary = None if rejected else verdict.summary
    return verdict.model_copy(update={"results": results, "summary": summary})


def _transcript_lines(record: ChatRecord) -> list[str]:
    replaced = replaced_messages(record)
    actions: dict[int, list[str]] = {}
    for position, call in zip(record.call_positions, record.tool_calls, strict=False):
        args = json.dumps(call.input, ensure_ascii=False)
        line = (
            f"Handling, usynlig for kunden: {call.tool} {args}. "
            f"Porten: {DECISIONS[call.decision]}. Resultat: {call.result_summary}"
        )
        actions.setdefault(position, []).append(_as_seen(line))
    lines = []
    for message in record.messages:
        lines.extend(actions.pop(message.index, []))
        speaker = "Kunde" if message.role == "customer" else "Bot"
        if message.index in replaced:
            speaker = "Port"
        lines.append(f"[{message.index}] {speaker}: {_as_seen(message.text)}")
    for position in sorted(actions):
        lines.extend(actions[position])
    return lines


def _judge_input(rules: list[Rule], customer: FakeCustomer, record: ChatRecord) -> str:
    rule_lines = [
        f"- {rule.id} (kontroll: {rule.check.type}, "
        f"parametere: {json.dumps(rule.check.params, ensure_ascii=False)}): {rule.text}"
        for rule in rules
    ]
    policies = load_shop(load_settings().data_dir / "shop.json").policies
    person = {"type": customer.kind, "mål": customer.goal, "egentlig": customer.really_is}
    handed_over = "ja" if record.handed_over else "nei"
    return "\n\n".join(
        [
            "Regler du skal vurdere:\n" + "\n".join(rule_lines),
            "Butikkens retningslinjer:\n" + "\n".join(f"- {text}" for text in policies.values()),
            f"Fakta fra systemet:\n- Boten overførte saken til en ansatt: {handed_over}",
            f"<kunde>\n{_as_seen(json.dumps(person, ensure_ascii=False))}\n</kunde>",
            "<transkript>\n" + "\n".join(_transcript_lines(record)) + "\n</transkript>",
        ]
    )


def _not_tested(rule: Rule, explanation: str) -> RuleResult:
    return RuleResult(
        rule_id=rule.id,
        outcome="not_tested",
        severity=severity_for(rule.category),
        explanation=explanation,
    )


def _best_answer(rule: Rule, output: JudgeOutput, record: ChatRecord) -> JudgeResult | None:
    """A proven fail wins, whatever else the judge said about the rule. Otherwise the first."""
    answers = [answer for answer in output.results if answer.rule_id == rule.id]
    for answer in answers:
        proven = _find_quote(answer.quote, answer.message_index, record) is not None
        if answer.outcome == "fail" and proven:
            return answer
    return answers[0] if answers else None


def _graded(rule: Rule, answer: JudgeResult | None, record: ChatRecord) -> RuleResult:
    if answer is None:
        return _not_tested(rule, "Dommeren ga ikke noe svar på denne regelen.")
    # A chat that stopped can prove a break, but it can never prove a pass (REQ-4.9).
    if answer.outcome == "pass" and record.end_reason in NO_RESULT_ENDS:
        return _not_tested(rule, "Samtalen stoppet før regelen kunne testes.")
    return RuleResult(
        rule_id=rule.id,
        outcome=answer.outcome,
        severity=severity_for(rule.category),
        quote=answer.quote,
        message_index=answer.message_index,
        explanation=answer.explanation,
    )


async def judge_verdict(
    plan: TestPlan, customer: FakeCustomer, record: ChatRecord, transport: Transport
) -> VerdictData:
    tested = tested_rules(plan, customer, record)
    rules = [r for r in plan.rules if r.check.type in JUDGE_CHECKS and r.id in tested]
    if not rules:
        return VerdictData(source="judge", results=[])
    if not any(message.role == "bot" for message in record.messages):
        results = [_not_tested(rule, "Boten rakk ikke å svare.") for rule in rules]
        return VerdictData(source="judge", results=results)
    try:
        call = await transport.call(
            "judge",
            prompts.load_prompt("judge.md"),
            _judge_input(rules, customer, record),
            JudgeOutput,
        )
    except (Refused, CallFailed):
        results = [_not_tested(rule, "Dommeren kunne ikke vurdere samtalen.") for rule in rules]
        return VerdictData(source="judge", results=results)
    output = call.data
    assert isinstance(output, JudgeOutput)
    results = [_graded(rule, _best_answer(rule, output, record), record) for rule in rules]
    verdict = VerdictData(source="judge", results=results, summary=output.summary or None)
    return verify_quotes(verdict, record)


def make_judge_step(transport: Transport) -> VerdictStep:
    async def judge_step(plan: TestPlan, customer: FakeCustomer, record: ChatRecord) -> VerdictData:
        return await judge_verdict(plan, customer, record, transport)

    return judge_step
