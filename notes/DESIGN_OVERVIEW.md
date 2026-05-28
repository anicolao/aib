# Design Overview

This codebase is a TypeScript NP4 turn player. It can log into Iron Helmet,
fetch one or more active games, build a replayable turn decision from live scan
data, optionally submit orders and diplomacy, record inputs for later replay,
and render concise CLI/debug-map output.

The current implementation is not a complete autonomous strategist and does not
yet contain a true MILP/LP turn solver. It is a deterministic turn pipeline with
a portfolio infrastructure optimizer, battle-aware tactical routing, defensive
hub logistics, bounded carrier construction, LLM-assisted diplomacy text, and
recorded game telemetry. The intended direction is still solver-centered, but
the shipped behavior is best described as a constrained planner with explicit
objective scores and auditable heuristics.

Core references:

- [../API_OVERVIEW.md](../API_OVERVIEW.md): NP4 scan schema and API caveats.
- [PROJECT.md](PROJECT.md): project notes and sibling reference directories.
- [SOLVER_DESIGN.md](SOLVER_DESIGN.md): current portfolio solver plus the
  longer-term MILP design.
- [DEFENSE_GRAPH_DESIGN.md](DEFENSE_GRAPH_DESIGN.md): defensive graph and hub
  model.
- [DISCORD_WEBHOOK_DESIGN.md](DISCORD_WEBHOOK_DESIGN.md): local CLI Discord
  reporting configuration.
- [sync.md](sync.md), [npa.md](npa.md), [np4api.md](np4api.md), and
  [np-tools.md](np-tools.md): external reference notes.

## Runtime Shape

The shared runtime is `runTurn` in [../src/run-turn.ts](../src/run-turn.ts).
One invocation:

1. loads a scan from a file, public API key, or authenticated account session;
2. optionally fetches diplomacy messages and event history;
3. records scan, messages, and events into `game-####/*.jsonl`;
4. calls `planTurn` in [../src/planner.ts](../src/planner.ts);
5. optionally asks Gemini to judge and flavor diplomacy drafts;
6. optionally submits orders, diplomacy, and turn-ready state.

Entrypoints:

- [../src/cli.ts](../src/cli.ts): local dry-run and submit CLI. With account
  credentials and no explicit game, it discovers active games and runs all of
  them. It prints Markdown summaries, pipes through `glow` when available, and
  can emit PNG debug maps.
- [../src/function.ts](../src/function.ts): scheduled Google Cloud Functions
  style handler that calls the same `runTurn` path.
- [../src/turn-loop.ts](../src/turn-loop.ts): local loop that waits a
  configurable delay, runs `node dist/cli.js --submit`, and allows pressing
  Enter to submit immediately.

CLI defaults currently use a 60-tick horizon. The cloud-function environment
path defaults to 30 unless `AIB_HORIZON_TICKS` is set, so deployment should set
that explicitly when parity with local dry-runs matters.

## Decision Record

`planTurn` returns a `DecisionRecord` containing:

- metadata for game, player, tick, production, turn mode, and dry-run mode;
- cash and count summaries;
- ordered command payloads and rationales;
- diplomacy drafts and tech-transfer decisions;
- combat summaries;
- defense graph details;
- damage/tick solver reports;
- rejected alternatives and explanatory notes.

This record is the main audit boundary. The CLI summary is intentionally
concise, but `--json` exposes the full decision for debugging and replay.

## Planning Pipeline

The current planner runs in this order:

1. Build owned scanned-star state and frontier weights.
2. Build a defense graph and visible incoming attack list.
3. Reserve idle carriers already sitting at defense hubs when the hub reserve
   needs them.
4. Plan tech-transfer responses and reserve trade cash.
5. Pre-plan urgent defensive carrier builds.
6. Pre-plan interior-to-hub carrier builds and core logistics carrier builds.
7. Pre-plan bounded offensive carrier builds against high-value enemy stars.
8. Reserve cash and ships for those mandatory/near-mandatory logistics choices.
9. Run the portfolio damage/tick infrastructure optimizer.
10. Emit tech transfers and possible research change to Weapons.
11. Route existing tactical fleets for garrison, hub reserve, direct defense,
    defense-graph reinforcement, and winning attacks.
12. Execute carrier-build plans, neutral expansion, supply shuttles, core
    logistics shuttles, underloaded carrier returns, and low-priority staging.
13. Draft diplomacy and optional attack objections.
14. Optionally mark turn-based games ready.

The ordering is important: tactical defense and reserved logistics constrain
ships/cash before infrastructure and expansion consume them.

## Infrastructure Optimizer

Infrastructure is handled by
[../src/damage-tick-solver.ts](../src/damage-tick-solver.ts). Despite the older
"LP" language in some archived notes, the current implementation is a greedy
portfolio search over current-turn E/I/S purchases:

- It evaluates complete terminal states after each candidate purchase rather
  than only immediate ratios.
- It builds combat zones from defense hubs, threatened stars, reachable enemy
  stars, reachable neutral stars, or owned frontier fallback stars.
- It scores reachable ships/tick, damage/tick, projected Weapons timing,
  economy payout inside the horizon, terminal infrastructure value, retained
  cash, and science floor value.
- It allows economy purchases only when the next submitted turn crosses a
  production boundary.
- Economy and science are location-weighted toward defendable stars; industry
  receives frontier/reachability value through combat zones.
- Industry and science are softened toward empire balance targets through
  terminal-value decay rather than planner-level hard caps.
- If Weapons looks strong enough relative to current research, the planner emits
  a `change_research` order.

Known gap: carrier allocation, ship allocation, hard defense constraints, and
multi-turn future infrastructure choices are still outside this optimizer. The
longer-term target is described in [SOLVER_DESIGN.md](SOLVER_DESIGN.md).

## Combat And Defense

Combat math lives in [../src/battle.ts](../src/battle.ts). It projects star
ships from current garrison, `yard`, industry, manufacturing, production rate,
and ETA, then simulates NP-style combat with defender weapon bonus.

The defensive graph in [../src/defense-graph.ts](../src/defense-graph.ts):

- treats visible enemy scanned stars and some visible idle enemy fleets as
  possible origins;
- excludes established formal allies from enemy origins and threat
  classification;
- computes which owned stars each origin can hit within the horizon;
- subtracts turn-jump ticks from defensive reaction windows in turn-based
  games;
- selects hubs greedily as a set-cover-like problem;
- classifies stars as `interior`, `covered`, `self_hub`,
  `exposed_high_value`, or `exposed_low_value`;
- records uncovered threatened stars and reserve requirements.

The planner then uses the graph in several ways:

- local idle carriers may be dropped into garrisons or defense hubs;
- existing carriers may reinforce visible attacks if they can arrive in time;
- if no existing carrier can save a visible attack, the planner may build a
  defensive or counterattack carrier;
- interior ships and carriers are staged toward hubs;
- all hubs have a standing mass target of
  `max(reserveShipsRequired, coverageValue)`, so surplus logistics continues
  toward under-massed hubs after urgent reserve gaps are filled;
- minimum-load carriers can leave threatened/front hubs to resupply, but loaded
  understrength carriers are not allowed to drain threatened hubs.

Known gaps: the graph plans against visible threats only, does not guarantee
survival against coordinated simultaneous multi-star attacks, and uses direct
range checks rather than full route search with gates/wormholes.

## Expansion, Attack, And Logistics

Neutral expansion:

- uses the configured horizon, not only "before next production";
- ignores neutrals already targeted by friendly fleets inside the horizon;
- prefers intrinsic star value from natural resources, industry, and science;
- requires five ships per capture;
- can use idle carriers first, then build carriers within the logistics budget.

Attack planning:

- routes idle carriers only to enemy stars they can visibly win against;
- skips low-value opportunistic targets;
- avoids targets already under friendly attack;
- can build at most one high-value offensive carrier per turn with surplus
  ships and available cash.

Logistics:

- direct supply shuttles originate only from interior, unthreatened stars and
  only target hubs with urgent reserve or standing-mass shortfall;
- core logistics can move ships one hop along owned-star paths toward a hub or
  other high-value sink;
- carrier builds can support hub supply and core logistics when no idle carrier
  is available;
- low-priority staging builds one carrier from a large surplus star toward enemy
  space only when the cash reserve allows.

## Diplomacy And Tech Trades

Diplomacy is intentionally constrained. The deterministic planner:

- identifies neighboring active empires;
- opens with research disclosure and tech-trade cooperation;
- treats replies within 8 hours as friendly enough to continue a thread;
- includes thread context for replies;
- avoids repeating routine trade confirmations once the thread already contains
  an agreement;
- drafts objections to visible inbound attacks;
- requests a formal alliance when committed exploration carriers have visible,
  unavoidable collision risk with another empire at a neutral star;
- accepts formal alliance offers when the other empire is not attacking, has not
  attacked recently, and the alliance has an immediate collision, border, or
  research-visibility benefit;
- reacts to received tech by reciprocating only when the thread names a concrete
  equivalent-level exchange and no aggression blocks trust.

If `GEMINI_API_KEY` is available, [../src/diplomacy-style.ts](../src/diplomacy-style.ts)
does two LLM-mediated tasks:

- judge otherwise-unhandled inbound messages for whether a response is warranted
  and produce a structured JSON result;
- rewrite draft text with a stable persona selected from `(gameId + playerUid)`.

The prompt explicitly requires NP hyperlink syntax for player and star names.
The model does not decide mechanical orders.

## Recording And Debugging

[../src/recorder.ts](../src/recorder.ts) appends replay inputs under
`game-####/`:

- `scandata.jsonl`
- `events.jsonl`

Each line includes metadata and the raw scan/message/event payloads needed to
replay or analyze a turn.

[../src/debug-map.ts](../src/debug-map.ts) renders a PNG showing stars,
fleets, visible paths, defense threats, hubs and coverage, and planned orders.
The CLI writes `game-####/debug-map-tick-####.png` and can display it through
kitty graphics when available.

## Source Map

- [../src/types.ts](../src/types.ts): scan data types.
- [../src/client.ts](../src/client.ts): login, scan fetch, message/event fetch,
  command submission, diplomacy submission, turn-ready submission.
- [../src/planner.ts](../src/planner.ts): main decision pipeline.
- [../src/damage-tick-solver.ts](../src/damage-tick-solver.ts): infrastructure
  portfolio optimizer and research recommendation.
- [../src/defense-graph.ts](../src/defense-graph.ts): threat graph, hub
  selection, star classification.
- [../src/battle.ts](../src/battle.ts): combat and projected star ships.
- [../src/star-graph.ts](../src/star-graph.ts): distance, travel ticks, range.
- [../src/star-value.ts](../src/star-value.ts): intrinsic star value.
- [../src/diplomacy-style.ts](../src/diplomacy-style.ts): Gemini judging and
  flavoring.
- [../src/discord-webhook.ts](../src/discord-webhook.ts): Discord webhook
  Markdown chunking and posting.
- [../src/debug-map.ts](../src/debug-map.ts): PNG renderer.
- [../src/recorder.ts](../src/recorder.ts): JSONL turn-input recorder.
- [../src/command.ts](../src/command.ts): command record shape.
- [../src/run-turn.ts](../src/run-turn.ts), [../src/cli.ts](../src/cli.ts),
  [../src/function.ts](../src/function.ts), [../src/turn-loop.ts](../src/turn-loop.ts):
  invocation surfaces.

## Current Limitations

- No full LP/MILP model is active yet.
- The infrastructure solver is greedy portfolio search, not global optimization.
- Tactical movement is mostly direct-leg or one-hop logistics; full A* route
  planning is not implemented.
- Gates, wormholes, and advanced client movement rules are not fully modeled.
- The planner uses visible data only; belief-state inference from scan history
  is not yet used for decisions.
- Diplomacy has thread-aware drafting, formal-alliance handling, and
  tech-transfer validation, but no durable trust model.
- There is no dedicated test suite beyond TypeScript compilation and ad hoc
  replay/dry-run checks.

## Archived Notes

Historical milestone plans have been moved under [archive](archive/). They are
kept for context but should not be treated as current design guidance.
