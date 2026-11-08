"""Serve the demo and open the three stage tabs in Chrome (`make pitch`, macOS only).

Usage: open_pitch.py [port]

The script starts no model run. The server keeps running until Ctrl+C.
"""

import socket
import subprocess
import sys
import time
from typing import Any

import httpx

DECK_URL = "https://claude.ai/artifact/Ton2SKbG6LHim2jgwjy64z"
DEFAULT_PORT = 8000
START_TIMEOUT_S = 60.0
HEALTH_CALL_TIMEOUT_S = 40.0  # the health page can wait 20 s for the Claude login check
POLL_S = 0.5
STOP_TIMEOUT_S = 5.0


def stage_urls(port: int) -> list[str]:
    """The tabs in stage order: the deck, the waiting replay, and the live app."""
    base = f"http://localhost:{port}"
    return [
        DECK_URL,
        f"{base}/?replay=before&speed=3#/stillingsannonse",
        f"{base}/#/stillingsannonse",
    ]


def chrome_script(urls: list[str]) -> str:
    """AppleScript for a new Chrome window with these tabs, the first tab in front."""
    more_tabs = "\n".join(
        f'  tell stage to make new tab with properties {{URL:"{url}"}}' for url in urls[1:]
    )
    return f"""tell application "Google Chrome"
  activate
  set stage to make new window
  set URL of active tab of stage to "{urls[0]}"
{more_tabs}
  set active tab index of stage to 1
end tell
delay 1
try
  tell application "System Events" to keystroke "f" using {{command down, control down}}
end try
"""


def blockers(health: dict[str, Any]) -> list[str]:
    """What stops the pitch: the replay and the plan must exist."""
    problems = [
        f"The replay {name} is missing." for name, ok in health["replays"].items() if not ok
    ]
    if not health["demo_plan"]:
        problems.append("The demo plan is missing or invalid.")
    return problems


def warnings(health: dict[str, Any]) -> list[str]:
    """What only stops «Send inn svindel»: the replay needs no model."""
    claude = health["claude"]
    problems = []
    if not (claude.get("installed") and claude.get("logged_in")):
        problems.append("The Claude check failed, so «Send inn svindel» may not work.")
    if claude.get("version_ok") is False:
        problems.append("The Claude version is too old, so «Send inn svindel» may not work.")
    limit_at = health["usage"]["last_limit_at"]
    if limit_at is not None:
        problems.append(f"The usage limit was last hit at {limit_at}. Check it before the pitch.")
    return problems


def port_in_use(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) == 0


def wait_for_health(port: int, server: subprocess.Popen[bytes]) -> dict[str, Any] | None:
    """The health answer, or None if the server exits or does not answer in time."""
    deadline = time.monotonic() + START_TIMEOUT_S
    while time.monotonic() < deadline and server.poll() is None:
        try:
            answer = httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=HEALTH_CALL_TIMEOUT_S)
        except httpx.HTTPError:
            time.sleep(POLL_S)
            continue
        if answer.status_code == 200:
            return answer.json()
        time.sleep(POLL_S)
    return None


def stop_server(server: subprocess.Popen[bytes], timeout_s: float = STOP_TIMEOUT_S) -> None:
    """Stop the server. An open event stream can stall a clean stop, so kill it after a wait."""
    server.terminate()
    try:
        server.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    port = int(args[0]) if args else DEFAULT_PORT
    if port_in_use(port):
        print(f"Port {port} is in use. Stop the other server first.", file=sys.stderr)
        return 1
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "provetid.api.app:app", "--port", str(port)]
    )
    try:
        health = wait_for_health(port, server)
        if health is None:
            print(
                "The engine did not answer /api/health in time. Read the output above.",
                file=sys.stderr,
            )
            return 1
        problems = blockers(health)
        for problem in problems:
            print(problem, file=sys.stderr)
        if problems:
            return 1
        for warning in warnings(health):
            print(f"WARNING: {warning}")
        try:
            subprocess.run(["osascript", "-e", chrome_script(stage_urls(port))], check=True)
        except (OSError, subprocess.CalledProcessError):
            print(
                "Could not open Chrome. `make pitch` needs macOS and Google Chrome.",
                file=sys.stderr,
            )
            return 1
        print("The tabs are open. Do these steps yourself:")
        print("1. Check that Chrome is in full screen. If not, press Ctrl+Cmd+F.")
        print("2. Start Present mode in tab 1. Do not click in tab 2.")
        print("3. Press Ctrl+C here after the pitch.")
        return server.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        stop_server(server)


if __name__ == "__main__":
    raise SystemExit(main())
