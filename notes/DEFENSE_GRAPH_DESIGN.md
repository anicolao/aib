# Defense Graph Design

The current player can issue legal orders, expand, and react to visible attacks,
but it still lacks an empire-level model of space. It needs to understand which
stars threaten which other stars, where friendly ships can respond in time, and
which positions can defend several neighbors from one reserve. This document
defines a first pass at that model.

## Goals

- Build an explicit graph of stars and travel times from every scan.
- Identify which enemy stars can attack each owned star.
- Account for turn-based detection delay when deciding whether a defense can
  arrive in time.
- Select defensive hub stars that can cover multiple threatened owned stars.
- Move ships into defensive reserves before spending ships on expansion.
- Expand quickly only with ships that are not needed for defense.
- Keep the model deterministic and explainable from a dry-run decision record.

## Core Concept

The bot should treat the empire as a graph-control problem. Every turn, it
should answer three questions before planning expansion:

1. Which owned stars can enemies reach?
2. Which friendly stars can defend those targets after detection delay?
3. Where should ships be massed so one reserve can defend many neighbors?

Only after those questions are answered should the planner allocate surplus
ships to neutral captures, attacks, or long-range staging.

## Star Graph

Each scan should be normalized into graph nodes and player-specific travel
edges.

```ts
interface StarNode {
  uid: number;
  name: string;
  ownerUid: number | null;
  x: number;
  y: number;
  naturalResources: number;
  ships: number;
  economy: number;
  industry: number;
  science: number;
  valueScore: number;
}

interface TravelEdge {
  from: number;
  to: number;
  distance: number;
  travelTicksByPlayer: Record<number, number>;
  reachableByPlayer: Record<number, boolean>;
}
```

Reachability is player-specific. Enemy propulsion, hyperspace range, gates, and
known travel bonuses may differ from ours. The graph therefore cannot store a
single "reachable" bit. It must know whether each relevant player can travel
between two stars and how long that travel takes.

For the first pass, the graph can use direct travel edges only. A later pass can
add multi-hop routes through friendly stars.

## Star Value

Every owned, neutral, and enemy star should receive a value score based only on
intrinsic economic and production value. Position, connectivity, and frontier
shape matter to the graph planner, but they should not be folded into star
value.

First-pass value inputs:

- natural resources
- industry
- science

Suggested shape:

```text
starValue =
  naturalResourcesWeight * naturalResources
+ industryWeight * industry
+ scienceWeight * science
```

Natural resources should be the dominant value for undeveloped stars. Industry
and science should make developed stars more important to defend or capture. A
high-NR neutral star is usually more important than a low-NR nearby neutral,
even if the low-NR star is easier to capture.

## Threat Model

For each owned star, enumerate visible enemy stars that can reach it.

```ts
interface Threat {
  enemyUid: number;
  enemyOriginStarUid: number;
  targetStarUid: number;
  enemyTravelTicks: number;
  reactionTicks: number;
  visibleAttackerShips: number;
  attackerWeapons: number;
  defenderWeapons: number;
  requiredReinforcement: number;
}
```

The initial threat model should consider visible enemy ships at enemy stars and
visible inbound fleets. Unknown enemy movement should be treated as uncertainty,
not as safety, but the first implementation can plan against visible threats
only and report uncertainty separately.

For each threat, use the battle calculator to estimate how many defending ships
are needed to survive the strongest plausible single attack from that origin.

## Turn-Based Detection Delay

In turn-based games, the bot does not see an attack at launch time. If turns
advance in 5-tick jumps, then the first scan showing an attack may arrive after
the attacking fleet has already traveled 5 ticks.

The defensive reaction window is therefore:

```text
reactionTicks = enemyTravelTicks - turnJumpTicks - safetyBuffer
```

For a 5-tick turn jump and no extra buffer:

```text
reactionTicks = enemyTravelTicks - 5
```

A friendly hub can defend a target only if:

```text
ourTravelTicks(hub, target) <= reactionTicks(enemyOrigin, target)
```

This is stricter than ordinary reachability. A star may be close enough to
defend in theory but too far away once detection delay is included.

The planner should emit this calculation in dry-run output for rejected defense
routes, because otherwise it will be hard to tell whether a route failed because
of range, timing, ship count, or combat odds.

## Defensive Coverage

A defensive hub is an owned star that can reach threatened neighbors before the
enemy can finish an attack after detection delay.

```ts
interface DefenseCoverage {
  hubStarUid: number;
  coveredTargetStarUids: number[];
  uncoveredTargetStarUids: number[];
  reserveShipsRequired: number;
  coverageValue: number;
}
```

For each candidate hub, compute which owned stars it can defend. A target is
covered by a hub if, for each relevant enemy origin that can attack the target,
the hub can send ships in time:

```text
covered(hub, target) =
  ourTravelTicks(hub, target) <= minReactionTicksForTarget
```

The reserve required at a hub should initially be the largest single
reinforcement requirement among its covered targets:

```text
reserveShipsRequired = max(requiredReinforcement(target))
```

This means one reserve is sized to defeat any one attack against the hub's
covered neighborhood. It does not yet guarantee survival against simultaneous
multi-star attacks. That is acceptable for the first pass, but the decision
trace should label the assumption.

## Hub Selection

Hub selection can start as a greedy set-cover problem:

1. Mark all valuable threatened owned stars as uncovered.
2. Score each candidate hub by covered value divided by reserve cost.
3. Pick the best hub.
4. Assign its covered targets.
5. Repeat until all important targets are covered or no feasible hub remains.

Suggested score:

```text
hubScore =
  coveredTargetValue
  / max(1, reserveShipsRequired + stagingCost)
```

`coveredTargetValue` should be the sum of the intrinsic value of the stars that
the hub can defend. `stagingCost` should estimate how many ships must be moved
from other stars to fill the hub reserve.

The selected hub plan should include:

- targets covered by the hub
- threats it covers
- reserve ships needed
- current ships at the hub
- deficit or surplus
- carriers needed to stage the reserve
- stars that remain uncovered

## Planner Priority

The turn planner should run defense before expansion.

1. **Active defense**
   - Resolve visible incoming attacks first.
   - Route ships if a defense can arrive in time and win.
   - If a defense cannot win, decide whether to preserve ships, counterattack,
     or abandon the star.

2. **Reserve planning**
   - Build the threat map.
   - Select defensive hubs.
   - Compute reserve deficits.
   - Stage ships toward underfilled hubs.

3. **Expansion**
   - Use only ships above defensive reserve requirements.
   - Prefer high-NR neutral stars.
   - Require enough landing ships to make the capture worth holding.
   - Avoid captures that create valuable but undefensible territory unless the
     planner explicitly marks them as raids.

4. **Attacks**
   - Attack enemy stars only with surplus ships.
   - Prefer enemy stars with high intrinsic value.
   - Attack only when the captured star can be held or the attack has a clear
     temporary purpose.

5. **Infrastructure**
   - Buy infrastructure after reserving cash for urgent carriers.
   - Science and propulsion should be valued partly through this graph: better
     technology increases coverage, reaction ability, and future threat range.

## Expansion With Defensive Reserves

Expansion should not mean "capture every reachable neutral star." It should
mean:

```text
capture the best neutral stars that still leave the empire defensible
```

For each candidate neutral capture, the planner should forecast the post-capture
defense state:

- Can an existing or new hub defend the captured star?
- Does capturing it uncover a more valuable owned star?
- How many ships must remain behind as reserve?
- Is the capture still valuable after accounting for hold requirements?

The first implementation can use a simple rule:

- reserve ships required by selected defense hubs are unavailable for expansion
- frontier stars assigned to a hub may spend only ships above their local or hub
  reserve contribution
- newly captured high-value stars should receive a hold requirement, not just a
  one-ship capture

## Dry-Run Output

Dry-run summaries should make the graph reasoning visible.

Recommended sections:

- threatened owned stars
- enemy origins that can reach each threatened star
- reaction ticks after turn-jump adjustment
- candidate defensive hubs
- selected hubs and covered targets
- uncovered stars and why they are uncovered
- reserve deficits
- staging orders
- expansion candidates rejected because they would consume reserve ships

Example:

```text
Defense graph:
- [[Gacrux]] threatened by [[Automaton]] from [[Diadem]]
  - enemy ETA: 12 ticks
  - turn jump: 5 ticks
  - reaction window: 7 ticks
  - required reinforcement: 18 ships
- [[Miram]] can defend [[Gacrux]]
  - friendly ETA: 6 ticks
  - result: feasible
- [[Cebalrai]] cannot defend [[Gacrux]]
  - friendly ETA: 9 ticks
  - result: too slow by 2 ticks
```

## Implementation Shape

Suggested modules:

- `src/starGraph.ts`
  - builds star nodes and player-specific travel edges
  - exposes reachability and travel-time queries

- `src/threatModel.ts`
  - enumerates enemy-origin to owned-target threats
  - applies turn-jump reaction windows
  - calls the battle calculator for required reinforcement

- `src/defenseGraph.ts`
  - computes candidate hub coverage
  - selects defensive hubs
  - returns reserve requirements and uncovered stars

- `src/planner.ts`
  - consumes the defense graph before expansion
  - reserves ships and cash
  - emits staging, defense, expansion, and attack decisions in priority order

The first implementation should avoid large refactors in `planner.ts`. It can
add graph-derived tactical inputs first, then gradually replace local heuristics
with graph decisions.

## First Milestone

The first useful milestone is not perfect defense. It is explainable defense.

MVP behavior:

- compute direct enemy reachability against every owned star
- subtract the turn jump from defensive reaction windows
- choose one or more defensive hubs by greedy coverage
- reserve enough ships at each hub for the largest covered single attack
- move idle carriers and surplus ships toward underfilled hubs
- block expansion from consuming reserved ships
- print a concise defense-graph summary in dry-run output

This should give the bot a defensive skeleton. Once the empire has a shape, the
expansion planner can grow from that shape instead of scattering carriers across
reachable stars.
