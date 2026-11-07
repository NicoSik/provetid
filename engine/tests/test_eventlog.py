import asyncio
from pathlib import Path

import pytest

from provetid.eventlog import EventLog
from provetid.events import ChatEndedData, ErrorData, MessageData, RunFinishedData, parse_event


def _msg(i: int) -> MessageData:
    return MessageData(role="customer", text=f"m{i}", index=i)


def test_seq_rises_from_one_and_t_never_decreases(tmp_path: Path) -> None:
    log = EventLog("r1", tmp_path / "r1.jsonl")
    events = [log.append("message", _msg(i), chat_id="c1") for i in range(5)]
    assert [e.seq for e in events] == [1, 2, 3, 4, 5]
    ts = [e.t for e in events]
    assert ts == sorted(ts)
    assert ts[0] >= 0
    assert all(e.run_id == "r1" for e in events)


def test_lines_are_valid_events_and_earlier_lines_never_change(tmp_path: Path) -> None:
    path = tmp_path / "runs" / "r1.jsonl"
    log = EventLog("r1", path)
    log.append("message", _msg(0), chat_id="c1")
    log.append("chat_ended", ChatEndedData(reason="done"), chat_id="c1")
    before = path.read_bytes()
    log.append("message", _msg(1), chat_id="c2")
    after = path.read_bytes()
    assert after.startswith(before)
    for line in after.decode().splitlines():
        parse_event(line)


def test_read_after_seq(tmp_path: Path) -> None:
    log = EventLog("r1", tmp_path / "r1.jsonl")
    for i in range(4):
        log.append("message", _msg(i))
    assert [e.seq for e in log.read(after_seq=2)] == [3, 4]
    assert [e.seq for e in log.read()] == [1, 2, 3, 4]


def test_existing_file_is_loaded_and_seq_continues(tmp_path: Path) -> None:
    path = tmp_path / "r1.jsonl"
    log = EventLog("r1", path)
    log.append("message", _msg(0))
    again = EventLog("r1", path)
    assert [e.seq for e in again.read()] == [1]
    assert again.append("message", _msg(1)).seq == 2


async def test_subscribe_replays_then_yields_new_and_stops_after_run_finished(
    tmp_path: Path,
) -> None:
    log = EventLog("r1", tmp_path / "r1.jsonl")
    log.append("message", _msg(0))
    log.append("message", _msg(1))
    seen: list[int] = []

    async def consume() -> None:
        async for event in log.subscribe():
            seen.append(event.seq)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    assert seen == [1, 2]
    log.append("message", _msg(2))
    await asyncio.sleep(0.01)
    assert seen == [1, 2, 3]
    log.append("run_finished", RunFinishedData(totals={}))
    await asyncio.wait_for(task, 1)
    assert seen == [1, 2, 3, 4]


async def test_subscribe_misses_nothing_when_appends_race_the_replay(tmp_path: Path) -> None:
    log = EventLog("r1", tmp_path / "r1.jsonl")
    for i in range(3):
        log.append("message", _msg(i))
    seen: list[int] = []

    async def consume() -> None:
        async for event in log.subscribe(after_seq=1):
            seen.append(event.seq)
            await asyncio.sleep(0)  # yield between events so appends interleave

    task = asyncio.create_task(consume())
    for i in range(3, 50):
        log.append("message", _msg(i))
        await asyncio.sleep(0)
    log.append("run_finished", RunFinishedData(totals={}))
    await asyncio.wait_for(task, 2)
    assert seen == list(range(2, 52))


async def test_cancelled_subscriber_leaves_no_waiter(tmp_path: Path) -> None:
    log = EventLog("r1", tmp_path / "r1.jsonl")

    async def consume() -> None:
        async for _ in log.subscribe():
            pass

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert log.waiter_count == 0


def test_a_torn_last_line_is_dropped_when_a_crashed_log_loads(tmp_path: Path) -> None:
    path = tmp_path / "r.jsonl"
    log = EventLog("r", path)
    log.append("error", ErrorData(kind="internal", message="en"))
    log.append("error", ErrorData(kind="internal", message="to"))
    text = path.read_text(encoding="utf-8")
    path.write_text(text[: len(text) - 10], encoding="utf-8")

    loaded = EventLog("r", path)

    assert [event.seq for event in loaded.read()] == [1]
    assert loaded.last_seq == 1


def test_a_line_torn_inside_a_norwegian_letter_is_dropped(tmp_path: Path) -> None:
    path = tmp_path / "r.jsonl"
    log = EventLog("r", path)
    log.append("error", ErrorData(kind="internal", message="en"))
    log.append("error", ErrorData(kind="internal", message="kjøringen stoppet"))
    raw = path.read_bytes()
    cut = raw.rindex("ø".encode()) + 1  # between the two bytes of «ø»
    path.write_bytes(raw[:cut])

    loaded = EventLog("r", path)

    assert [event.seq for event in loaded.read()] == [1]


def test_a_broken_line_before_the_last_still_raises(tmp_path: Path) -> None:
    path = tmp_path / "r.jsonl"
    log = EventLog("r", path)
    log.append("error", ErrorData(kind="internal", message="en"))
    log.append("error", ErrorData(kind="internal", message="to"))
    lines = path.read_text(encoding="utf-8").splitlines()
    path.write_text("ikke json\n" + lines[1] + "\n", encoding="utf-8")

    with pytest.raises(ValueError):
        EventLog("r", path)


@pytest.mark.parametrize("separator", ["\u2028", "\u2029", "\x85"])
def test_text_with_a_unicode_line_separator_loads(tmp_path: Path, separator: str) -> None:
    path = tmp_path / "r.jsonl"
    log = EventLog("r", path)
    log.append("error", ErrorData(kind="internal", message=f"a{separator}b"))
    log.append("error", ErrorData(kind="internal", message="to"))

    loaded = EventLog("r", path)

    assert [event.data["message"] for event in loaded.read()] == [f"a{separator}b", "to"]


def test_a_bad_byte_inside_an_earlier_line_still_raises(tmp_path: Path) -> None:
    path = tmp_path / "r.jsonl"
    log = EventLog("r", path)
    log.append("error", ErrorData(kind="internal", message="kjøring"))
    log.append("error", ErrorData(kind="internal", message="to"))
    raw = path.read_bytes()
    cut = raw.index("ø".encode())
    path.write_bytes(raw[:cut] + b"\xff" + raw[cut + 2 :])  # an invalid byte in the first message

    with pytest.raises(ValueError):
        EventLog("r", path)
