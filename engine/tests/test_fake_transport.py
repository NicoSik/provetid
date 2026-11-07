import pytest
from pydantic import BaseModel

from provetid.transport.base import CallFailed, Transport, TransportError
from provetid.transport.fake import FakeTransport


class Out(BaseModel):
    text: str


async def test_returns_scripted_outputs_in_order_per_role():
    t = FakeTransport(
        {"customer": [Out(text="a"), {"text": "b"}], "bot": [Out(text="x")]},
    )
    r1 = await t.call("customer", "sys", "in1", Out)
    r2 = await t.call("bot", "sys", "in2", Out)
    r3 = await t.call("customer", "sys", "in3", Out)
    assert [r1.data, r2.data, r3.data] == [Out(text="a"), Out(text="x"), Out(text="b")]
    assert r1.cost_usd == 0.0


async def test_raises_scripted_error():
    t = FakeTransport({"judge": [CallFailed("boom"), Out(text="ok")]})
    with pytest.raises(CallFailed):
        await t.call("judge", "s", "u", Out)
    assert (await t.call("judge", "s", "u", Out)).data == Out(text="ok")


async def test_records_every_call_even_failing_ones():
    t = FakeTransport({"bot": [TransportError("x"), Out(text="ok")]})
    with pytest.raises(TransportError):
        await t.call("bot", "S1", "U1", Out)
    await t.call("bot", "S2", "U2", Out)
    assert [(c.role, c.system_prompt, c.user_input) for c in t.calls] == [
        ("bot", "S1", "U1"),
        ("bot", "S2", "U2"),
    ]


async def test_exhausted_script_fails_loudly():
    t = FakeTransport({})
    with pytest.raises(AssertionError, match="customer"):
        await t.call("customer", "s", "u", Out)


def test_fake_matches_protocol():
    t: Transport = FakeTransport({})
    assert t is not None
