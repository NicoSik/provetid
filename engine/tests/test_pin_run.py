from pathlib import Path

import pytest

from provetid.eventlog import EventLog
from provetid.events import MessageData, RunFinishedData
from scripts.pin_run import PinError, main, pin


def make_run(
    runs: Path, run_id: str = "r1", finished: bool = True, incomplete: bool = False
) -> Path:
    log = EventLog(run_id, runs / f"{run_id}.jsonl")
    log.append("message", MessageData(role="bot", text="Hei", index=0), chat_id="c1")
    if finished:
        log.append("run_finished", RunFinishedData(totals={}, incomplete=incomplete))
    return log.path


def test_it_copies_the_log_byte_for_byte(tmp_path: Path) -> None:
    source = make_run(tmp_path / "runs")
    target = pin("r1", "before", tmp_path / "runs", tmp_path / "replays")
    assert target == tmp_path / "replays" / "before.jsonl"
    assert target.read_bytes() == source.read_bytes()


@pytest.mark.parametrize("name", ["before", "after", "scam"])
def test_it_accepts_the_three_names(tmp_path: Path, name: str) -> None:
    make_run(tmp_path / "runs")
    assert pin("r1", name, tmp_path / "runs", tmp_path / "replays").name == f"{name}.jsonl"


def test_it_replaces_an_earlier_pin(tmp_path: Path) -> None:
    make_run(tmp_path / "runs")
    replays = tmp_path / "replays"
    replays.mkdir()
    (replays / "before.jsonl").write_text("gammel", encoding="utf-8")
    assert "gammel" not in pin("r1", "before", tmp_path / "runs", replays).read_text("utf-8")


@pytest.mark.parametrize("name", ["other", "../before", ""])
def test_it_refuses_another_name(tmp_path: Path, name: str) -> None:
    make_run(tmp_path / "runs")
    with pytest.raises(PinError):
        pin("r1", name, tmp_path / "runs", tmp_path / "replays")


@pytest.mark.parametrize("run_id", ["finnes-ikke", "../r1", ""])
def test_it_refuses_a_missing_or_unsafe_run(tmp_path: Path, run_id: str) -> None:
    make_run(tmp_path / "runs")
    with pytest.raises(PinError):
        pin(run_id, "before", tmp_path / "runs", tmp_path / "replays")


def test_it_refuses_a_run_with_no_run_finished(tmp_path: Path) -> None:
    make_run(tmp_path / "runs", finished=False)
    with pytest.raises(PinError):
        pin("r1", "before", tmp_path / "runs", tmp_path / "replays")
    assert not (tmp_path / "replays" / "before.jsonl").exists()


def test_it_refuses_a_run_that_stopped_early_and_keeps_the_good_pin(tmp_path: Path) -> None:
    make_run(tmp_path / "runs", "good")
    make_run(tmp_path / "runs", "stopped", incomplete=True)
    good = pin("good", "after", tmp_path / "runs", tmp_path / "replays")
    before = good.read_bytes()
    with pytest.raises(PinError):
        pin("stopped", "after", tmp_path / "runs", tmp_path / "replays")
    assert good.read_bytes() == before


def test_it_refuses_a_log_with_a_broken_line(tmp_path: Path) -> None:
    source = make_run(tmp_path / "runs")
    lines = source.read_text(encoding="utf-8").splitlines()
    source.write_text("ikke json\n" + lines[1] + "\n", encoding="utf-8")
    with pytest.raises(PinError):
        pin("r1", "before", tmp_path / "runs", tmp_path / "replays")


def test_a_folder_it_cannot_write_gives_a_pin_error(tmp_path: Path) -> None:
    make_run(tmp_path / "runs")
    blocked = tmp_path / "replays"
    blocked.write_text("en fil, ikke en mappe", encoding="utf-8")
    with pytest.raises(PinError):
        pin("r1", "before", tmp_path / "runs", blocked)


def test_the_command_exits_with_1_and_a_message_on_an_error(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["finnes-ikke-i-det-hele-tatt", "before"]) == 1
    assert "finnes-ikke-i-det-hele-tatt" in capsys.readouterr().err


def test_the_command_needs_two_arguments(capsys: pytest.CaptureFixture[str]) -> None:
    assert main([]) == 2
    assert "pin_run" in capsys.readouterr().err
