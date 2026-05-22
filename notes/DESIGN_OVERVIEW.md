# Design Overview

This is a first-pass design for evolving the Neptune's Pride Agent codebase from
a passive information layer into an autonomous, cloud-hosted NP4 player. The
central idea is to combine exact optimization for mechanical choices with a
separate agentic layer for uncertain, social, and long-horizon decisions.

The design should stay grounded in the raw scan model documented in
[../API_OVERVIEW.md](../API_OVERVIEW.md), the generated types in
[../src/types.ts](../src/types.ts), and the reference implementations described
in this directory.

## Goals

- Play a private NP4 game autonomously from scan data and submitted commands.
- Make economy, industry, science, carrier, and route choices from explicit
  objective functions rather than loose heuristics.
- Preserve the distinction between known scan facts, inferred state, and
  strategic speculation.
- Play competently with and against human players, including negotiated trades,
  alliance posture, threat assessment, and timing coordination.
- Run as a scheduled Google Cloud Functions implementation with clear logs,
  replayable decisions, and recoverable state.

## Non-Goals for the First Iteration

- Human-like personality, bluffing, or natural-language roleplay.
- Real-time micro-optimization under clock pressure.
- Autonomous play in public games without explicit consent.
- Full replacement of the existing NPA UI.
- General support for every historical Neptune's Pride API variant.

## Tri-Layer Brain

The player should split decisions by horizon and uncertainty.

| Layer | Component | Function |
| --- | --- | --- |
| Strategic | LLM Planner | Interprets global state, tracks player relationships, chooses diplomatic and technology posture, and selects high-level goals. |
| Tactical | Graph Search / A* | Computes carrier routes, reinforcement paths, interception opportunities, and range-limited attacks. |
| Operational | Linear Program / MILP | Allocates credits across infrastructure, gates, carriers, and possibly science targets under budget and timing constraints. |

The layers should communicate through typed state summaries and proposed
actions, not through direct mutation of raw scan objects. Every chosen action
should remain traceable back to the scan tick and objective that produced it.

## State Model

The bot should maintain several views of game state:

- Raw scan: the latest `scanning_data`, stored without dropping unknown fields.
- Normalized state: friendly field names and derived indexes over stars, fleets,
  players, tech, visibility, and ownership.
- Belief state: inferred or merged facts from prior scans, allied scans, message
  history, and event history.
- Forecast state: simulated future ticks for fleet movement, production,
  research, combat, and cash.
- Decision ledger: actions considered, objective values, selected commands, and
  rejected alternatives.

The raw scan is authoritative for visible facts. The belief and forecast states
must label uncertainty explicitly so the strategic layer does not mistake
inference for observation.

## Operational Optimization

The first optimization engine should solve a bounded "star infrastructure
problem" over a short look-ahead window.

Candidate objective:

- maximize frontier-relevant ship count at a target tick
- include secondary value for industrial capacity, science growth, and cash
  retained
- penalize spending that cannot affect the selected horizon

Candidate decision variables:

- buy or hold economy, industry, and science at each scanned owned star
- buy or hold gates where legal and strategically relevant
- build or defer carriers
- optionally reserve credits for diplomacy or emergency orders

Candidate constraints:

- current and projected cash budget
- infrastructure cost formulas from star resources and game config
- production timing via `productionCounter` and `productionRate`
- research timing via total science and visible tech costs
- star visibility and ownership
- carrier cost and fleet availability

Although the notes call this "LP", most buy decisions are discrete. The
implementation may need a mixed-integer linear program, dynamic programming, or
a greedy relaxation backed by exact local search. The important requirement is
not the solver label; it is that the objective, constraints, and selected build
order are explicit and replayable.

## Tactical Planning

The tactical layer should treat the galaxy as a weighted graph over stars and
possibly in-flight fleet positions.

Core responsibilities:

- compute fastest paths under propulsion range, gates, wormholes, and scanning
  limits
- estimate ETA and arrival order for friendly and visible hostile fleets
- identify frontier stars where marginal ships matter
- evaluate carrier splits, loops, garrisons, and reinforcements
- feed combat-relevant deadlines into the operational optimizer

Reference formulas should come from the synced client in `../sync` notes and
from NPA's `timetravel`, `combatcalc`, and `visibility` modules. The first pass
can use current visible data only; later versions can incorporate belief-state
estimates for unscanned enemy movement.

## Strategic Agent

The strategic layer should operate on compressed, typed summaries rather than
the full scan payload. It should set goals and policies such as:

- expand, consolidate, defend, tech-rush, or prepare an attack
- preferred research target
- reserve ratio for tactical flexibility
- players to trade with, coordinate with, deter, attack, or ignore
- acceptable risk thresholds for unscanned stars and unknown fleets

The agent should be allowed to propose plans, but deterministic validators must
reject illegal, unaffordable, or strategically inconsistent commands before they
reach the game API.

## Human Diplomacy

The first milestone should focus on playing well in games with human players.
Diplomacy should be modeled as a constrained decision problem over incentives,
trust, timing, and military leverage rather than as a personality simulator.

Responsibilities:

- track each player's public empire strength, visible military posture, known
  messages, known trades, promises, threats, and prior cooperation
- evaluate proposed cash, technology, and coordination trades as investments
  with expected strategic return
- identify mutually beneficial trades and timing agreements the bot can explain
  clearly to a human player
- maintain an explicit trust and risk model without assuming any player will act
  predictably
- separate generated message drafts from game-state actions so communication can
  be reviewed or gated independently

The planner may draft concise messages, but the first implementation should
prefer auditable recommendations and deterministic trade validation over broad
autonomous negotiation.

## Execution Environment

The primary runtime target is Google Cloud Functions. A scheduled invocation
should wake up roughly once per hour, fetch the latest game state, update stored
state, make bounded decisions, and submit any validated commands.

Runtime responsibilities:

- run from Cloud Scheduler or an equivalent scheduled trigger
- fetch scans on each hourly invocation, with turn-based games allowed to skip
  submission when no new turn is available
- persist raw scans, normalized snapshots, forecasts, decisions, and submitted
  commands between stateless function invocations
- use managed secrets for API keys and game credentials
- make invocations idempotent so retries do not duplicate orders
- expose structured logs and decision traces for review
- support dry-run mode where decisions are produced but not submitted

The first lab environment should be private turn-based games with consenting
human players, plus replayed historical scans where available. This keeps the
focus on human-player diplomacy and strategic quality while avoiding real-time
latency concerns.

## Local Debug CLI

The cloud function should share its core implementation with a CLI entry point.
The CLI should run one decision cycle and emit the same artifacts a single cloud
function invocation would produce:

- scan metadata and freshness
- normalized state summary
- forecast assumptions
- candidate actions and objective scores
- selected actions
- rejected actions with reasons
- command payloads in dry-run mode

The local development environment may be a nix-darwin MacOS laptop, but that is
only a development convenience. The code should not assume the laptop runtime is
the production deployment target.

## Command Boundary

The command subsystem should be narrow and auditable. It should accept validated
intentions from the planners and translate them into game actions such as:

- buy infrastructure
- build carrier
- create or update fleet orders
- send cash or technology
- set research target
- end turn where applicable

No strategic layer should submit commands directly. The command boundary should
perform final validation against the latest scan and should fail closed if the
scan is stale, the action is illegal, or the expected game state has changed.

## Testing Strategy

Useful test layers:

- schema tests against `api.sample.json` and NPA sample scans
- formula tests for range, scanning, gates, wormholes, production, and ETA
- optimizer tests with small hand-solvable economies
- replay tests over saved scan sequences
- dry-run integration tests in private turn-based games
- CLI/function parity tests that compare one CLI run with one function
  invocation over the same stored input
- regression tests for command validation and stale-scan rejection

The first useful milestone is not "wins a game". It is a replayable turn where
the bot explains its chosen purchases, routes, diplomacy actions, and omitted
alternatives from a fixed scan.

The post-MVP implementation plan is expanded in
[POST_MVP_DESIGN.md](POST_MVP_DESIGN.md). That document translates this
architecture into the next concrete planner rewrite: forecast state, bounded
infrastructure search, tactical task search, and carrier budget policy.

## First Metric Decision

The first operational metric should prioritize maximum frontier-relevant fleet
count at a chosen future tick.

Reasons:

- it directly connects economy purchases to combat outcomes
- it forces the optimizer to respect production timing and travel time
- it produces decisions that can be checked against visible threats
- it is easier to validate than fastest total tech advancement

Fastest tech advancement should remain a secondary or strategic objective. The
strategic layer can choose tech-rush mode when the board state permits, but the
first solver should optimize for ships that can affect a concrete frontier by a
specific tick.

## Open Questions

- Which solver should be used in the TypeScript runtime, and does it need MILP
  support immediately?
- What is the minimal legal command API for private-game automation?
- Which Google Cloud storage service should hold scan history, decisions, and
  idempotency records?
- How much belief-state history is needed before the bot can make useful
  unscanned-fleet assumptions?
- How should risk tolerance be represented so an LLM can set policy without
  bypassing deterministic safety checks?
- Which NPA formulas should be ported first, and which should remain reference
  material until needed?
