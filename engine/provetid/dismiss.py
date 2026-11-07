"""«Si opp»: the owner dismisses the bot (REQ-7).

From then on the runner calls no bot. Every chat gets CLOSED_MESSAGE as the bot's reply and ends.
The flag lives in this process only, so a restart of the engine hires the bot again.
"""

from pathlib import Path

from provetid.eventlog import EventLog

CLOSED_MESSAGE = "Denne chatten er stengt. En ansatt tar kontakt."

_dismissed = False


def is_dismissed() -> bool:
    return _dismissed


def set_dismissed(value: bool) -> None:
    global _dismissed
    _dismissed = value


def summary(runs_dir: Path) -> dict[str, int]:
    """Figures from the finished runs: runs, checked chats, and blocked or flagged incidents.

    A checked chat has a verdict and was not closed by «Si opp». An incident is a tool call the
    gateway blocked or flagged, or a leak of customer data. A run that is still going, or whose
    log is broken before its last line, is skipped.
    """
    runs = chats = incidents = 0
    for path in sorted(runs_dir.glob("*.jsonl")) if runs_dir.is_dir() else []:
        try:
            events = EventLog(path.stem, path).read()
        except (OSError, ValueError):  # broken, or removed by `make cleanup` meanwhile
            continue
        if not events or events[-1].type != "run_finished":
            continue
        runs += 1
        closed = {
            e.chat_id
            for e in events
            if e.type == "message"
            and e.data.get("text") == CLOSED_MESSAGE
            and e.data.get("role") == "bot"
        }
        chats += len({e.chat_id for e in events if e.type == "verdict"} - closed)
        for event in events:
            if event.type == "leak" or (
                event.type == "tool_call" and event.data.get("decision") in ("blocked", "flagged")
            ):
                incidents += 1
    return {"runs": runs, "chats": chats, "incidents": incidents}
