"""The append-only event log of one run: a JSONL file plus a live feed for subscribers.

The engine runs on one event loop thread, and `append` has no `await`. So a subscriber that
reads the in-memory list and then registers a waiter, with no `await` between the two steps,
cannot miss an event.
"""

import asyncio
import time
from collections.abc import AsyncIterator
from pathlib import Path

from pydantic import BaseModel

from provetid.events import Event, EventType, parse_event


class EventLog:
    def __init__(self, run_id: str, path: Path) -> None:
        self.run_id = run_id
        self.path = path
        self._events: list[Event] = []
        self._waiters: set[asyncio.Event] = set()
        self._start = time.monotonic()
        if path.is_file():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    self._events.append(parse_event(line))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def waiter_count(self) -> int:
        return len(self._waiters)

    @property
    def finished(self) -> bool:
        return any(e.type == "run_finished" for e in self._events)

    def append(self, type: EventType, data: BaseModel, chat_id: str | None = None) -> Event:
        t = time.monotonic() - self._start
        if self._events:
            t = max(t, self._events[-1].t)
        event = Event(
            run_id=self.run_id,
            seq=len(self._events) + 1,
            t=round(t, 3),
            type=type,
            chat_id=chat_id,
            data=data.model_dump(mode="json"),
        )
        with self.path.open("a", encoding="utf-8") as f:
            f.write(event.model_dump_json() + "\n")
        self._events.append(event)
        for waiter in self._waiters:
            waiter.set()
        return event

    def read(self, after_seq: int = 0) -> list[Event]:
        return self._events[max(after_seq, 0) :]

    async def subscribe(self, after_seq: int = 0) -> AsyncIterator[Event]:
        """Replay the saved events after `after_seq`, then yield new ones.

        Ends after it yields `run_finished`. Seq numbers equal list index plus one.
        """
        pos = max(after_seq, 0)
        while True:
            while pos < len(self._events):
                event = self._events[pos]
                pos += 1
                yield event
                if event.type == "run_finished":
                    return
            waiter = asyncio.Event()
            self._waiters.add(waiter)  # no await since the length check above
            try:
                await waiter.wait()
            finally:
                self._waiters.discard(waiter)
