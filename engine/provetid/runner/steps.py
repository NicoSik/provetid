"""The verdict steps that run after each chat. Later tasks add steps here."""

from provetid.runner.run import VerdictStep
from provetid.transport.base import Transport
from provetid.verdict.checks import code_verdict


def default_steps(transport: Transport) -> list[VerdictStep]:
    return [code_verdict]
