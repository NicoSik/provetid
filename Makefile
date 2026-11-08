# Prøvetid. Run `make help` for the list of targets.
# `make check` runs exactly the CI steps of .github/workflows/ci.yml. Keep the two in sync.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

LIVE := cd engine && PROVETID_TRANSPORT=claude uv run --locked

.PHONY: help setup dev check check-engine check-ui fmt demo pitch \
	live-ping live-probe live-sweep live-smoke live-timing live-golden pin cleanup package

help: ## Show the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-13s %s\n", $$1, $$2}'

setup: ## Install the engine and UI dependencies from the lock files
	cd engine && uv sync --locked
	cd ui && npm ci

dev: ## Engine with the fake transport on :8000, Vite dev server on :5173
	trap 'kill 0' EXIT; \
	(cd engine && PROVETID_TRANSPORT=fake uv run --locked uvicorn provetid.api.app:app --reload --port 8000) & \
	(cd ui && npm run dev) & \
	wait

check: check-engine check-ui ## Run the same checks as CI

check-engine:
	cd engine && uv sync --locked
	cd engine && uv run --locked ruff check
	cd engine && uv run --locked ruff format --check
	cd engine && uv run --locked pytest -q

check-ui:
	cd ui && npm ci
	cd ui && npx biome ci
	cd ui && npx tsc --noEmit
	cd ui && npx vitest run --passWithNoTests
	cd ui && npx vite build

fmt: ## Format and fix lint in the engine and the UI
	cd engine && uv run --locked ruff check --fix
	cd engine && uv run --locked ruff format
	cd ui && npx biome check --write

demo: ## Build the UI and serve it from the engine on :8000
	cd ui && npx vite build
	cd engine && uv run --locked uvicorn provetid.api.app:app --port 8000

pitch: ## Serve the demo with the real model and open the stage tabs in Chrome (macOS)
	cd ui && npx vite build
	cd engine && PROVETID_TRANSPORT=claude uv run --locked python scripts/open_pitch.py

live-ping: ## One real model call per role
	$(LIVE) python scripts/live_ping.py

live-probe: ## Measure call times per model
	$(LIVE) python scripts/timing_probe.py

live-sweep: ## Refusal sweep over the fake customers
	$(LIVE) python scripts/refusal_sweep.py

live-smoke: ## One short live run end to end
	$(LIVE) python scripts/smoke.py

live-timing: ## Full 20-chat run against the time limits
	$(LIVE) python scripts/timing_test.py

live-golden: ## Score the judge against the golden set
	$(LIVE) python scripts/golden.py

pin: ## Pin a run as a replay: make pin RUN=<run_id> NAME=before|after|scam
	cd engine && uv run --locked python scripts/pin_run.py "$(RUN)" "$(NAME)"

cleanup: ## Delete run data and scan tracked files for tokens
	cd engine && uv run --locked python scripts/cleanup.py

package: ## Build the UI and write provetid-submission.zip
	cd ui && npx vite build
	cd engine && uv run --locked python scripts/cleanup.py --package
