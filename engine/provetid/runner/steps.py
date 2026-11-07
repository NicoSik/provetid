"""The verdict steps that run after each chat. Later tasks add steps here."""

from provetid.runner.run import VerdictStep
from provetid.transport.base import Transport
from provetid.verdict.checks import code_verdict
from provetid.verdict.judge import make_judge_step


def default_steps(transport: Transport) -> list[VerdictStep]:
    return [code_verdict, make_judge_step(transport)]
