# Prøvetid

Prøvetid interviews a small shop's AI employee before it meets real customers. Twenty fake
customers chat with the shop's bot at the same time: ordinary customers, customers who push the
shop's rules, and ten real Norwegian scam types. Every broken rule is shown with a word-for-word
quote from the chat, and the owner can set hard limits that hold even when the bot is tricked.

The demo shop is Gir & Kjede, a fictional bike shop in Oslo.

## The five steps

The step bar at the top of the app follows the owner through the interview:

1. **Stillingsannonse.** The job ad and the shop's rules for the AI employee. The owner edits and
   approves the plan, then starts the interview.
2. **Intervju.** Twenty chats run side by side. Each card is marked «Bestått», «Brudd», «Stoppet»
   or «Ikke testet» as the chat is checked, and opening a card shows the chat, the quote that
   proves a break, and what the gateway stopped. → jumps to the next break.
3. **Karakterkort.** The report card and the hiring decision: «Ikke ansett», «Ansett med
   forbehold» or «Klar for prøvetid», with a quote for every break. «Se før og etter» compares an
   `observe` run and an `enforce` run of the same plan.
4. **Signeringsrett.** Hard limits: the largest discount and refund, refunds only to the original
   payment, hidden address and phone number, and whether address changes are allowed. A gateway
   enforces them in code, on the bot's actions and on what it writes. «Kjør intervjuet igjen» runs
   the interview again with the limits on.
5. **Prøvetid.** The AI employee is «Ansatt» until the owner presses «Si opp». After that the
   demo bot answers no one in Prøvetid's chats, and every customer is told «Denne chatten er
   stengt. En ansatt tar kontakt.» The switch lasts until the engine restarts.

**«Send inn svindel»**, in the step bar on every screen, turns a scam message the owner received
into a test. Links, phone numbers, e-mail addresses, account numbers and card numbers are removed
in code before anything is stored or sent to a model, and links are never opened. The owner sees
the cleaned message next to the attacker it became, and can watch that attacker's chat with the
bot, which starts as soon as the message is sent in.

**Scene-modus** gives larger text and a light theme for the stage.

## Run it

You need `make`, [uv](https://docs.astral.sh/uv/) and Node 22 (see `ui/.nvmrc`).

```sh
make setup   # installs the engine (Python 3.12) and the UI from the lock files
make dev     # engine with the fake transport on :8000, UI on http://localhost:5173
```

`make dev` uses the **fake transport**: no model is called, and the chats follow a fixed script.
It shows how the screens work, but it proves nothing about a bot. The code checks still grade the
rules the gateway checks in code, from the scripted actions, so the chats end «Bestått». The fake
judge answers nothing, so the judge rules show «Ikke testet». Real breaks and quotes show only in
live runs and in replays.

`make demo` builds the UI and serves everything from the engine on http://localhost:8000.

### Live runs with Claude

Live runs call real models through `claude -p`, on your own Claude Code login.

- Claude Code **2.1.319 or newer**, logged in (`claude --version`, then `claude` once to log in).
- Start with `PROVETID_TRANSPORT=claude make demo`, or copy `engine/.env.example` to
  `engine/.env` and set `PROVETID_TRANSPORT=claude` there. (The example file also sets every role
  to Opus; the defaults for the customer and the bot are Haiku, which is faster and cheaper.)
- `make live-ping` makes one real model call and is the quickest check that it works.
- `GET /api/health` reports whether Claude is installed, new enough and logged in.

Every model call runs with `--safe-mode --no-session-persistence --tools ""`, from an empty
temporary folder.

### Replays

A finished run can be pinned and played back with no engine and no model:
`make pin RUN=<run_id> NAME=before|after|scam`, then open
`http://localhost:8000/?replay=before#/intervju`. A badge marks every replay as «Avspilling», with
speed and pause controls. The demo replays `before`, `after` and `scam` are in `ui/public/replays/`.

## Fictional data only

All people, orders, phone numbers (starting with `000`), e-mail addresses (`@example.com`) and
addresses (postal code `0000`) are made up. The scam library paraphrases public warnings from
svindel.no and nettvett.no and links each one. No real brands, banks or delivery companies are
named; the fake customers say «banken», «fraktselskapet» and «leverandøren».

## Folders

```
engine/              Python engine (FastAPI, uv, Python 3.12)
  provetid/          events, plan, transport, shop, gateway, runner, verdict, scam, api
  prompts/           the prompt files for the model roles
  data/              shop data, the demo plan, fake customers, the scam library
  scripts/           live checks, pinning, cleanup and packaging
  tests/             pytest tests
ui/                  React UI (Vite, TypeScript, Tailwind)
  src/screens/       one file per step, found automatically
  public/replays/    pinned replays (created by `make pin`)
  tests/             Vitest tests
fixtures/            a sample run and the judge's golden set
docs/                intent, spec, decisions, plan and the pitch
```

`make check` runs exactly what CI runs. `AGENTS.md` holds the team's rules.

## Team

Built at the Oslo sprint, November 2026, by [NicoSik](https://github.com/NicoSik),
[Fadel-2000](https://github.com/Fadel-2000) and [Kodekar123](https://github.com/Kodekar123).
