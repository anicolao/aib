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
- Use built-in AI diplomacy mechanics deliberately where they are available,
  especially regard, cash gifts, and technology trades.
- Run persistently in a reproducible Nix/NixOS environment with clear logs,
  replayable decisions, and recoverable state.

## Non-Goals for the First Iteration

- Human-like personality, bluffing, or natural-language roleplay.
- Real-time micro-optimization under clock pressure.
- Autonomous play against unaware human opponents.
- Full replacement of the existing NPA UI.
- General support for every historical Neptune's Pride API variant.

## Tri-Layer Brain

The player should split decisions by horizon and uncertainty.

| Layer | Component | Function |
| --- | --- | --- |
| Strategic | Agentic AI | Interprets global state, tracks dispositions, chooses diplomatic and technology posture, and selects high-level goals. |
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
- players to trade with, bribe, attack, ignore, or keep viable
- acceptable risk thresholds for unscanned stars and unknown fleets

The agent should be allowed to propose plans, but deterministic validators must
reject illegal, unaffordable, or strategically inconsistent commands before they
reach the game API.

## Diplomacy and Built-In AI Handling

The built-in AI should be modeled as a predictable economic actor, not as a
human opponent. The design name for this subsystem is the Triton protocol.

Responsibilities:

- track each AI player's `regard`, economy, tech levels, status, and viability
- evaluate cash gifts and tech trades as investments with expected return
- prefer trade loops when cheaper than conquest or independent research
- avoid destroying useful AI trade partners unless military value dominates
- consider transferring low-value stars only when it improves long-term
  tradeability or board position

The protocol should be state-machine driven. It should record the expected
effect of each gift, trade, or attack on future regard and technology access.

## Execution Environment

The intended runtime is a persistent cloud-hosted process, likely deployed in a
Nix/NixOS environment and aligned with the `devcon` project architecture.

Runtime responsibilities:

- fetch scans on a schedule appropriate to turn-based or real-time games
- persist raw scans, normalized snapshots, forecasts, decisions, and submitted
  commands
- recover cleanly after process restarts
- expose logs and decision traces for review
- separate credentials and secrets from committed source
- support dry-run mode where decisions are produced but not submitted

The first lab environment should be a private turn-based game against built-in
AI players. This isolates strategic correctness from real-time latency and
allows every decision to be replayed before command submission is automated.

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
- regression tests for command validation and stale-scan rejection

The first useful milestone is not "wins a game". It is a replayable turn where
the bot explains its chosen purchases, routes, diplomacy actions, and omitted
alternatives from a fixed scan.

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
- How much belief-state history is needed before the bot can make useful
  unscanned-fleet assumptions?
- How should risk tolerance be represented so an LLM can set policy without
  bypassing deterministic safety checks?
- Which NPA formulas should be ported first, and which should remain reference
  material until needed?
