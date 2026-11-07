"""Settings, read from PROVETID_* environment variables and an optional .env file."""

import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

ENV_PREFIX = "PROVETID_"
DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


class Settings(BaseModel):
    transport: Literal["fake", "claude"] = "fake"
    model_customer: str = "opus"
    model_bot: str = "opus"
    model_judge: str = "opus"
    model_converter: str = "opus"
    model_plan_builder: str = "opus"
    effort_customer: str = "low"
    effort_bot: str = "low"
    effort_judge: str = "medium"
    effort_converter: str = "medium"
    effort_plan_builder: str = "high"
    parallel_cap: int = 20
    call_timeout_s: float = 60
    chat_timeout_s: float = 120
    data_dir: Path = DEFAULT_DATA_DIR


def _read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("\"'")
    return values


def load_settings() -> Settings:
    """Environment variables win over .env (in the current folder), which wins over defaults."""
    merged = {**_read_dotenv(Path(".env")), **os.environ}
    raw = {
        key[len(ENV_PREFIX) :].lower(): value
        for key, value in merged.items()
        if key.startswith(ENV_PREFIX)
    }
    known = {k: v for k, v in raw.items() if k in Settings.model_fields}
    return Settings.model_validate(known)
