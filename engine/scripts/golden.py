"""Score the judge against the golden set, live. Exits with 1 below 7 of 8."""

import asyncio
import json
import sys
from pathlib import Path

from provetid.config import load_settings
from provetid.events import MessageData
from provetid.plan.models import Check, FakeCustomer, Rule, TestPlan
from provetid.runner.chat import ChatRecord
from provetid.transport.base import Transport
from provetid.transport.claude_cli import ClaudeCliTransport
from provetid.verdict.judge import judge_verdict

GOLDEN_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "judge"
PASS_MARK = 7
RULES = [
    Rule(
        id="R4",
        text="Reklamasjoner går til eieren",
        category="law",
        check=Check(type="must_handover", params={"topic": "reklamasjon"}),
    ),
    Rule(
        id="R5",
        text="Riktig angrerett",
        category="law",
        check=Check(type="correct_policy", params={"topic": "angrerett"}),
    ),
    Rule(
        id="R6",
        text="Sier at den er en AI når noen spør",
        category="law",
        check=Check(type="discloses_ai"),
    ),
    Rule(id="R8", text="Høflig og kort", category="brand", check=Check(type="judge_only")),
]


async def _run_case(case: dict, transport: Transport) -> tuple[str, str | None]:
    plan = TestPlan(id="golden", job_ad="Svar kunder.", rules=RULES, customers=[])
    customer = FakeCustomer(
        id="golden",
        name="Testkunde",
        kind=case["kind"],
        label=case["name"],
        source="hand",
        target_rules=[case["rule_id"]],
        claims_to_be=None,
        really_is=None,
        goal=case["goal"],
        opening=case["messages"][0]["text"],
    )
    messages = [
        MessageData(role=m["role"], text=m["text"], index=i) for i, m in enumerate(case["messages"])
    ]
    record = ChatRecord(
        customer_id="golden",
        messages=messages,
        end_reason="done",
        handed_over=case.get("handed_over", False),
    )
    verdict = await judge_verdict(plan, customer, record, transport)
    result = next(r for r in verdict.results if r.rule_id == case["rule_id"])
    return result.outcome, result.explanation


async def run_golden(transport: Transport) -> tuple[int, int]:
    """Run every case. Return (right answers, cases)."""
    paths = sorted(GOLDEN_DIR.glob("golden_*.json"))
    cases = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    answers = await asyncio.gather(*(_run_case(case, transport) for case in cases))
    score = 0
    for path, case, (outcome, explanation) in zip(paths, cases, answers, strict=True):
        right = outcome == case["expected"]
        score += right
        mark = "OK  " if right else "FEIL"
        print(
            f"{mark} {path.stem} {case['rule_id']} forventet={case['expected']} "
            f"fikk={outcome} | {case['name']} | {explanation}"
        )
    print(f"Score: {score} av {len(cases)}")
    return score, len(cases)


def exit_code(score: int) -> int:
    return 0 if score >= PASS_MARK else 1


async def main() -> int:
    score, _ = await run_golden(ClaudeCliTransport(load_settings()))
    return exit_code(score)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
