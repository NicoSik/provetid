import socket
import subprocess
import sys
from pathlib import Path

from scripts import open_pitch
from scripts.open_pitch import (
    blockers,
    chrome_script,
    main,
    port_in_use,
    stage_urls,
    stop_server,
    warnings,
)

PITCH_MD = Path(__file__).resolve().parents[2] / "docs" / "pitch" / "pitch.md"

HEALTHY = {
    "claude": {"checked": True, "installed": True, "version_ok": True, "logged_in": True},
    "usage": {"last_limit_at": None},
    "demo_plan": True,
    "replays": {"before": True, "after": True, "scam": True},
}


def test_stage_urls_match_the_setup_in_the_script() -> None:
    urls = stage_urls(8000)
    assert len(urls) == 3
    setup = PITCH_MD.read_text(encoding="utf-8")
    positions = [setup.index(url) for url in urls]
    assert positions == sorted(positions)
    assert "replay=before&speed=3" in urls[1]
    assert "replay" not in urls[2]


def test_stage_urls_use_the_port() -> None:
    assert all("localhost:8777" in url for url in stage_urls(8777)[1:])


def test_chrome_script_opens_the_tabs_in_order_with_the_first_in_front() -> None:
    urls = ["https://a.example.com", "https://b.example.com", "https://c.example.com"]
    script = chrome_script(urls)
    assert "make new window" in script
    positions = [script.index(f'"{url}"') for url in urls]
    assert positions == sorted(positions)
    assert "set active tab index of stage to 1" in script


def test_a_healthy_engine_has_no_blockers_or_warnings() -> None:
    assert blockers(HEALTHY) == []
    assert warnings(HEALTHY) == []


def test_a_missing_replay_or_plan_blocks() -> None:
    health = HEALTHY | {"demo_plan": False, "replays": {"before": False, "after": True}}
    problems = blockers(health)
    assert len(problems) == 2
    assert any("before" in problem for problem in problems)


def test_a_claude_problem_only_warns_because_the_replay_needs_no_model() -> None:
    health = HEALTHY | {"claude": {"checked": True, "installed": True, "logged_in": False}}
    assert blockers(health) == []
    assert len(warnings(health)) == 1


def test_port_in_use() -> None:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        assert port_in_use(port)
    assert not port_in_use(port)


def test_main_stops_before_it_starts_a_server_when_the_port_is_taken(monkeypatch) -> None:
    def no_server(*args: object, **kwargs: object) -> None:
        raise AssertionError("must not start a server")

    monkeypatch.setattr(open_pitch.subprocess, "Popen", no_server)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        assert main([str(listener.getsockname()[1])]) == 1


def test_a_usage_limit_warns_with_the_time() -> None:
    health = HEALTHY | {"usage": {"last_limit_at": "2026-11-08T10:00:00+00:00"}}
    assert blockers(health) == []
    problems = warnings(health)
    assert len(problems) == 1
    assert "2026-11-08T10:00:00+00:00" in problems[0]


def test_an_old_claude_version_warns() -> None:
    claude = HEALTHY["claude"] | {"version_ok": False}
    assert len(warnings(HEALTHY | {"claude": claude})) == 1


def test_stop_server_kills_a_server_that_does_not_stop() -> None:
    server = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import signal, time\n"
            "signal.signal(15, signal.SIG_IGN)\n"
            "print('up', flush=True)\n"
            "time.sleep(60)",
        ],
        stdout=subprocess.PIPE,
    )
    assert server.stdout is not None
    server.stdout.readline()  # the child ignores SIGTERM from here on
    stop_server(server, timeout_s=0.2)
    assert server.returncode is not None
