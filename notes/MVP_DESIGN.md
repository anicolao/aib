# MVP Design

This document narrows the first implementation milestone to a single useful
turn cycle: load game state, make basic infrastructure and routing decisions,
and produce the command payloads that would play the turn.

## Milestone Scope

The MVP should be able to:

- fetch one NP4 scan using `GAME_ID` and `API_KEY`
- normalize enough scan data to identify our player, owned scanned stars,
  visible fleets, cash, technology, and turn state
- choose a small set of infrastructure purchases from current cash
- route idle owned carriers toward a simple frontier objective
- optionally build one carrier when there is enough cash and a good source star
- emit a replayable decision record with raw command strings
- emit draft diplomacy messages for neighboring empires
- optionally submit validated commands through the game API when account
  credentials are supplied

The MVP is intentionally deterministic. It does not use an LLM yet. Its purpose
is to establish the command boundary, the decision trace shape, and a safe
debugging loop.

## Runtime Shape

The core entry point is a single "turn invocation" function. It accepts
configuration, loads a scan, runs the planner, and either returns a dry-run
decision record or submits command payloads.

The same core should be callable from:

- a local CLI for debugging
- a future Google Cloud Functions scheduled handler

The CLI and the initial `scheduledTurn` handler both call the shared
`runTurn` core. The CLI prints the same JSON record the cloud function logs or
returns.

## Authentication

The preferred MVP scan path uses account credentials to request the same
full-universe report the browser client loads:

```text
POST /game_api/order
type=order&order=full_universe_report&gameId=[GAME_ID]&version=np4
```

This keeps local dry-runs aligned with the logged-in browser view and avoids
requiring a generated scan API code for every game. The CLI can also discover
active games from `NP_USER` and `NP_PASSWD` through `/account_api/init_player`
and dry-run each active game.

The public scan API remains supported when a game number and API key are
available:

```text
GET /api?game_number=[GAME_ID]&api_version=0.1&code=[API_KEY]
```

Live command submission uses the same account session. The client submits
commands to
`/game_api/order` and batched infrastructure commands to
`/game_api/batched_orders`, authenticated by an account session cookie. The MVP
therefore supports two modes:

- dry-run: `NP_USER` and `NP_PASSWD` can discover and scan active games, or
  `GAME_ID` plus `API_KEY` can fetch one public scan
- submit: account `NP_USER` and `NP_PASSWD` are required; with no explicit
  `GAME_ID`, the CLI submits planned turns for every active discovered game

Dry-run is the default. Submission should fail closed if credentials are
missing.

## Decision Heuristics

Infrastructure is a greedy heuristic, not the final LP/MILP:

- reserve a configurable fraction of cash plus enough for a carrier
- repeatedly score affordable economy, industry, and science purchases
- skip economy unless the next turn advances across a production boundary
- skip industry purchases that would raise a star above one industry per two
  economy
- skip science purchases that would raise a star above one science per two
  industry
- value economy by production cycles remaining in the horizon
- value industry by ships produced over the horizon, weighted toward frontier
  stars
- value science lightly so the bot does not completely starve research
- emit `upgrade_economy`, `upgrade_industry`, and `upgrade_science` commands
  with the exact cost used in the decision

Carrier routing is intentionally direct but no longer just "send everything to
the frontier":

- use one full production cycle as the expansion horizon
- identify neutral stars directly reachable within that horizon
- assign existing idle carriers to reachable neutral stars first
- reserve enough cash to build carriers for the remaining reachable neutral
  stars, when source stars have spare ships
- record a follow-up route for newly built carriers so live submission can use
  the returned fleet UID
- after expansion coverage, build defensive carriers at owned stars with a
  visible incoming threat inside the expansion horizon and no owned carrier
  already present
- do not route through multi-hop paths yet

This is enough to produce a coherent first turn without pretending to be a full
strategic player.

Diplomacy is draft-only in the MVP:

- identify neighboring empires by nearest known star distance
- draft an opening message to each neighbor that names current research and
  proposes mutually profitable tech trading
- treat a neighbor as friendly if they replied within eight hours of one of our
  outbound diplomacy messages
- when a friendly neighbor has the latest message, draft a reply that keeps the
  tech-trade conversation moving
- when `GEMINI_API_KEY` is configured, rewrite the draft body with a stable
  persona chosen from the game ID and player UID; persona archetypes are
  original sci-fi voices inspired by heroic or villainous space-opera and
  starship-diplomat roles
- retain the plain draft beside the flavored draft for auditability
- submit diplomacy drafts only when the turn is explicitly run with `--submit`;
  new outreach creates a diplomacy thread and follow-up replies are posted as
  message comments when a prior thread is known
- in turn-based games, after all order and diplomacy submissions succeed, submit
  `force_ready` so the turn is marked ready; this also happens when there were
  no orders or messages to issue

## Command Payloads

The MVP emits client-compatible order strings:

- `upgrade_economy,[starUid],[cost]`
- `upgrade_industry,[starUid],[cost]`
- `upgrade_science,[starUid],[cost]`
- `new_fleet,[starUid],[ships]`
- `add_fleet_orders,[fleetUid],[delays],[targets],[actions],[amounts],[loop]`
- `force_ready`

Infrastructure commands are submitted as one `/game_api/batched_orders` payload
joined with `/`. Other commands are submitted individually to `/game_api/order`.

## Safety

- Dry-run is default.
- Live order and diplomacy submission requires an explicit `--submit` flag or
  equivalent config.
- `force_ready` is not emitted unless explicitly requested.
- Commands are generated from the latest scan loaded during the invocation.
- The planner emits reasons for selected and rejected actions.
- The submitter preserves order: batched infrastructure first, then one-off
  orders.

## Next Steps After MVP

- Replace greedy infrastructure scoring with an exact optimizer.
- Add multi-hop graph routing.
- Persist scan and decision records.
- Add stale-scan and duplicate-command protection.
- Add deployment and Cloud Scheduler configuration for hourly invocation.
- Add human diplomacy summaries and message-draft support.
