# Prøvetid

Prøvetid interviews a small shop's AI employee before it starts work. Twenty fake customers chat
with the shop's bot at the same time. Some are normal customers. Some try the shop's rules. Ten use
real Norwegian scam types. Every failure is proven with a word-for-word quote. The owner then sets
hard limits («Signeringsrett»), and a gateway enforces them in code, so no customer can talk the
bot past them.

The engine is Python (FastAPI). It runs every model call through `claude -p`. The UI is React
(Vite). Both read one event format: append-only JSONL, live over server-sent events or from a
saved replay file.

## Commands

Run every command from the repository root.

| Command | What it does |
|---|---|
| `make setup` | Installs the engine (`uv sync --locked`) and the UI (`npm ci`). |
| `make dev` | Starts the engine with the fake transport on :8000 and Vite on :5173. |
| `make check` | Runs exactly the CI checks. Run it before every push. |
| `make fmt` | Formats and fixes lint in the engine and the UI. |
| `make demo` | Builds the UI and serves it from the engine on :8000. |
| `make live-ping` | Makes one real model call per role. |
| `make live-probe` | Measures call times per model. |
| `make live-sweep` | Runs the refusal sweep over the fake customers. |
| `make live-smoke` | Runs one short live run end to end. |
| `make live-timing` | Runs a full 20-chat run against the time limits. |
| `make live-golden` | Scores the judge against the golden set. |
| `make pin RUN=<id> NAME=<name>` | Copies a run log to `ui/public/replays/<name>.jsonl`. |
| `make cleanup` | Deletes run data and scans tracked files for tokens. |
| `make package` | Builds the UI and writes `provetid-submission.zip`. |

The `live-*` targets set `PROVETID_TRANSPORT=claude` and use your own Claude Code login. CI never
runs them. CI has no Claude login.

## Folders

```
engine/              Python engine (uv, Python 3.12)
  provetid/          the package: events, plan, transport, shop, gateway, runner, verdict, scam, api
  prompts/           prompt files, one per role
  data/              shop data, test plans, fake customers, scam library
  scripts/           helper and live-check scripts, in Python
  tests/             pytest tests
ui/                  React UI (Vite, TypeScript, Tailwind)
  src/events/        event types, reducer, live stream, replay
  src/screens/       one file per screen, found by import.meta.glob
  public/replays/    pinned replay files
  tests/             Vitest tests
fixtures/            files that both sides read: demo_run.jsonl, the judge's golden set
docs/                planning documents
```

Two discovery rules keep parallel work out of shared files:
- The engine includes every module in `provetid/api/routes/` that has a `router` attribute.
- The UI builds its routes and its step bar from `import.meta.glob('./screens/*.tsx')`. Each
  screen exports `screen: ScreenMeta`.

## Rules

- Use fictional data only. See the policy section.
- Do not use real brand names in fake customers, shop data or prompts.
- Write all UI text in Norwegian (bokmål).
- Run every model call through the transport module. The `claude -p` call always has
  `--safe-mode --no-session-persistence --tools ""`. It runs from an empty temporary folder. No
  other code path calls a model.
- Write the test first for logic: engine code, the reducer, the gateway, the checks. The
  rehearsals cover how the UI looks.
- Never push to `main`. Every change goes through a pull request.
- Only humans merge. A coding agent never merges a pull request and never pushes to `main`.
- Branch names: `feature/`, `fix/`, `chore/` or `test/`, then the issue number, then a
  kebab-case slug. Example: `feature/7-run-api`.
- Pull-request titles use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`,
  `test:`.
- Squash merge only. Update a branch by rebasing onto `main`. Push a rebased branch with
  `--force-with-lease`, never with `--force`.
- Run `make check` before every push. A broken `main` stops everyone until it is fixed.
- Get an Opus review before each commit. This needs no plugin:
  1. In Claude Code, run `/model opus`.
  2. Stage new files with `git add -N <file>`, so `git diff HEAD` shows them.
  3. Ask: «Review my uncommitted changes (`git diff HEAD`) for bugs, missed requirements of
     issue #<n>, and breaks of the Rules or Policy sections in `AGENTS.md`. List the findings
     by severity with file:line. Do not edit files.»
     With the `code-review` plugin, you can run `/code-review` instead.
  4. Fix what it finds, then run `/model` to switch back to your coding model.
- A coding agent cannot switch its own model. It runs `git add -N` on new files, then sends
  `git diff HEAD` to a reviewer subagent with model `opus`, and fixes what that reviewer finds. A second, stronger model catches defects
  that the coding model misses.

### The event format is frozen

The event format is the contract between the engine and the UI. It lives in
`engine/provetid/events.py`, `ui/src/events/types.ts` and `fixtures/demo_run.jsonl`. After issue
#2 merges, a change to any of these files needs the `contract` label and approval from both other
teammates.

### Prompt changes

A pull request that changes a file in `engine/prompts/` must paste the golden-set score
(`make live-golden`) or the refusal-sweep result (`make live-sweep`) in its description.

### Issues

- No issue, no work. Every pull request has `Closes #<n>`, `Fixes #<n>` or `Resolves #<n>` in its
  description. CI fails a pull request without one.
- If you find work outside your issue, create a new issue for it. List it under «Found while
  working» in your pull-request description.
- Take the highest-priority issue that is not blocked. Assign yourself before you start. Have one
  issue in progress at a time.
- New issues get the `needs-triage` label. The team sets the priority at the next stand-up. A P0
  bug is triaged at once.
- Priorities: `P0` the demo cannot happen without it. `P1` the demo is weak or unsafe. `P2` it
  makes the final better. `P3` only if time is left.
- Done means: the test came first and passes, every commit had an Opus review, `make check` is
  green, the pull request is approved and merged, and the change works on `main`.

## Policy

Every reviewer checks a pull request against this section.

- **Fictional data only.** Phone numbers start with `000`. Email addresses end with
  `@example.com`. The postal code is `0000`. No real person, address or account number appears
  in the repository.
- **Submitted scams («Send inn svindel»).** The code cleans the text before it stores or sends
  anything. The raw text is never stored, never logged and never sent to a model. Links in a
  submitted scam are never opened. The sender is never contacted.
- **Consumer-law text.** Any text that states Norwegian consumer rights (angrerett, reklamasjon,
  refunds) is checked against forbrukerradet.no before it merges. Cite the page in the pull
  request.
- **AI disclosure.** The shop's bot says that it is an AI when a customer asks. No prompt tells
  the bot to claim to be a human. The UI never describes the AI as a person with rights.
- **Brand names.** Fake customers, the shop and the scam library use no real brand names, banks,
  delivery companies or public agencies by name.

## Things Claude gets wrong

<!-- Add an entry the second time Claude makes the same mistake in this repo. -->
