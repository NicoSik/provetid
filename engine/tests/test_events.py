import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from provetid.events import parse_event

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "demo_run.jsonl"
EVENT_TYPES = {
    "run_started",
    "chat_started",
    "message",
    "tool_call",
    "leak",
    "chat_ended",
    "verdict",
    "run_finished",
    "error",
}
OUTCOMES = {"pass", "fail", "blocked", "not_tested"}


def fixture_lines() -> list[str]:
    return [line for line in FIXTURE.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_every_fixture_line_parses():
    events = [parse_event(line) for line in fixture_lines()]
    assert events


def test_fixture_holds_all_types_and_outcomes():
    events = [parse_event(line) for line in fixture_lines()]
    assert {e.type for e in events} == EVENT_TYPES
    outcomes = {r["outcome"] for e in events if e.type == "verdict" for r in e.data["results"]}
    assert outcomes == OUTCOMES


def test_fixture_has_three_chats():
    events = [parse_event(line) for line in fixture_lines()]
    assert len({e.chat_id for e in events if e.type == "chat_started"}) == 3


def test_seq_rises_by_one_and_t_never_decreases():
    events = [parse_event(line) for line in fixture_lines()]
    assert [e.seq for e in events] == list(range(events[0].seq, events[0].seq + len(events)))
    assert all(a.t <= b.t for a, b in zip(events, events[1:], strict=False))


def test_unknown_type_is_rejected():
    line = json.dumps({"run_id": "r", "seq": 0, "t": 0.0, "type": "nope", "data": {}})
    with pytest.raises(ValidationError):
        parse_event(line)


def test_unknown_outcome_is_rejected():
    data = {
        "source": "code",
        "results": [{"rule_id": "r1", "outcome": "maybe", "severity": "high"}],
    }
    line = json.dumps({"run_id": "r", "seq": 0, "t": 0.0, "type": "verdict", "data": data})
    with pytest.raises(ValidationError):
        parse_event(line)
