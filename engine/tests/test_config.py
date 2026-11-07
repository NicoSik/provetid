from pathlib import Path

import pytest
from pydantic import ValidationError

from provetid.config import Settings, load_settings


def test_defaults(monkeypatch, tmp_path):
    for key in list(__import__("os").environ):
        if key.startswith("PROVETID_"):
            monkeypatch.delenv(key)
    monkeypatch.chdir(tmp_path)
    s = load_settings()
    assert s.transport == "fake"
    # M1-b: Haiku plays the customer and the bot; the other roles stay on Opus.
    assert (s.model_customer, s.model_bot) == ("haiku", "haiku")
    assert s.model_judge == s.model_converter == s.model_plan_builder == "opus"
    assert (s.effort_customer, s.effort_judge, s.effort_plan_builder) == ("low", "medium", "high")
    assert s.parallel_cap == 20
    assert s.call_timeout_s == 60
    assert s.chat_timeout_s == 120
    assert s.data_dir == Path(__file__).resolve().parent.parent / "data"


def test_env_overrides_default(monkeypatch):
    monkeypatch.setenv("PROVETID_MODEL_CUSTOMER", "sonnet")
    monkeypatch.setenv("PROVETID_PARALLEL_CAP", "5")
    s = load_settings()
    assert s.model_customer == "sonnet"
    assert s.parallel_cap == 5


def test_dotenv_is_read_and_env_wins(monkeypatch, tmp_path):
    (tmp_path / ".env").write_text("PROVETID_MODEL_BOT=haiku\nPROVETID_MODEL_JUDGE=sonnet\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PROVETID_MODEL_JUDGE", "opus")
    monkeypatch.delenv("PROVETID_MODEL_BOT", raising=False)
    s = load_settings()
    assert s.model_bot == "haiku"
    assert s.model_judge == "opus"


def test_unknown_transport_fails(monkeypatch):
    monkeypatch.setenv("PROVETID_TRANSPORT", "carrier-pigeon")
    with pytest.raises(ValidationError):
        load_settings()


def test_settings_is_plain_model():
    assert Settings().transport == "fake"
