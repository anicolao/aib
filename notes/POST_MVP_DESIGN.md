# Post-MVP Player Design

The MVP proved the command boundary and scan loop, but its turn quality is still
mostly heuristic. The next design should replace "pick a plausible action" with
"score a constrained plan against a forecast". This document defines that next
pass.

## Design Goals

- Optimize infrastructure from an explicit objective over a forecast horizon.
- Search combat and routing plans over future arrival states, not one carrier at
  a time.
- Treat carriers as scarce logistics capacity with a budget, not as the default
  answer to every problem.
- Keep each decision replayable from a scan, event history, and planner config.
- Preserve the current dry-run JSON shape, but add enough detail to explain why
  one plan beat another.

## Planner Pipeline

The turn planner should become a staged pipeline:

1. Normalize the latest scan into indexed state.
2. Build a forecast model for production, research, cash, fleet movement, and
   visible combat over the next `H` ticks.
3. Generate strategic goals: defend, expand, attack, consolidate, research,
   trade, or hold cash.
4. Generate candidate tactical tasks with deadlines and ship requirements.
5. Allocate existing carriers and decide whether new carriers are worth buying.
6. Reserve cash for required logistics, tech transfers, and emergency defense.
7. Optimize infrastructure purchases against the remaining budget and tactical
   goals.
8. Validate selected commands against the original scan and emit the decision
   trace.

The important change is that infrastructure no longer runs before tactics with
only a crude carrier reserve. Tactical tasks produce marginal ship and cash
values; the infrastructure optimizer consumes those values.

## Forecast Model

The forecast model should be deterministic and side-effect free. It should not
submit orders or mutate the raw scan.

Inputs:

- latest scan
- recent scans and event history, when available
- candidate commands already selected earlier in the pipeline
- horizon in ticks
- risk policy

Outputs:

- cash at each tick
- production events by tick
- research completion estimates
- star ship counts by tick
- fleet positions, ETAs, and arrival order
- visible combat outcomes
- uncertainty labels for unscanned or stale enemy positions

First pass forecast assumptions:

- use only current scan plus current event history
- model visible fleets and scanned stars exactly
- model unscanned enemy movement as unknown, not absent
- project industry production at production boundaries
- project research only enough to estimate tech completion timing
- ignore future diplomacy except already planned tech transfers

This module should absorb the relevant formulas now scattered across
`planner.ts` and `battle.ts`, then later port stronger references from NPA's
`timetravel`, `combatcalc`, and `visibility` modules.

## Infrastructure Optimization

Infrastructure should be optimized as a bounded integer search. The current
"buy best next ratio" approach is too myopic because one expensive economy
purchase can dominate several cheap purchases only at the right production
deadline, and industry value depends on where ships can arrive.

### State

For each owned scanned star:

- current economy, industry, science, resources, ships, gate state
- cost of the next economy, industry, science, and gate purchase
- frontier value curve by tick
- defensive value curve by tick
- logistics access: which tactical tasks ships from this star can affect

For the empire:

- current cash
- expected production income by tick
- committed carrier and tech-transfer reserves
- research progress and expected tech completions
- configured risk reserve

### Objective

Maximize expected utility at the horizon:

```text
utility =
  frontierShipsValue
+ defendedStarsValue
+ capturedStarsValue
+ futureIncomeValue
+ researchProgressValue
+ retainedCashValue
- overspendRiskPenalty
- unreachableShipPenalty
- overbuildingBacklinePenalty
```

The weights should be explicit planner config. A reasonable first profile:

- primary: ships that can affect threatened or contested frontier stars before
  the next production cycle plus one travel cycle
- secondary: economy that pays before the horizon
- secondary: industry whose ships can reach a frontier before the horizon
- tertiary: science when research is below the empire's target pace
- small value: retained cash for tactical flexibility

### Solver Shape

The first implementation should use exact branch-and-bound over affordable
single-level purchases rather than introduce a MILP dependency immediately.

Reasons:

- NP turns usually have a small enough candidate set after filtering.
- Purchases are integer and sequential because costs change after each buy.
- The search can be deterministic and easy to debug.
- We can replace the solver later without changing the planner contract.

Candidate filtering before search:

- include only scanned owned stars
- include economy only if it can produce income inside the horizon
- include industry only if produced ships can matter inside the horizon
- include science only if it can change research completion or strategic score
- include at most the next `K` levels per star and kind
- exclude purchases that violate configurable ratio caps unless the strategic
  profile explicitly relaxes them

Branch-and-bound:

- recursively choose buy or skip for candidate purchases
- after buying, update star state, cash, and dependent costs
- compute an optimistic upper bound from remaining candidates' marginal utility
- prune branches below the incumbent
- return the full ordered purchase list, final cash, utility breakdown, and
  rejected branches summary

The optimizer should emit selected and rejected alternatives with enough detail
to answer "why did it buy economy here instead of industry there?"

## Tactical Search

Combat planning needs to move from local greedy assignments to a search over
tasks, carriers, deadlines, and ship counts.

### Tactical Tasks

Represent every military need as a task:

- defend star `S` by tick `T` with at least `N` ships
- capture neutral star `S` by tick `T` with at least `N` ships
- attack enemy star `S` by tick `T` with at least `N` ships and target margin
- reinforce rally point `S` by tick `T`
- stage ships from backline star `A` toward frontier `B`

Each task should carry:

- value if completed
- penalty if missed
- deadline
- minimum and preferred ships
- acceptable source stars or fleets
- required carrier capacity
- risk classification

### Route Graph

Build a graph where nodes are owned stars, visible neutral stars, visible enemy
stars, and current fleet positions. Edges exist when a carrier can legally fly
between nodes under current range, gates, wormholes, and speed.

First pass:

- direct edges only plus one intermediate owned-star hop
- no redirect of in-flight carriers
- no splitting in-flight carriers
- account for carriers already committed by existing orders

Next pass:

- A* or Dijkstra over multi-hop routes
- arrival-order simulation for chains of reinforcement
- candidate fleet splits when a carrier has surplus ships

### Combat Search

For each visible enemy origin, enumerate stars it can hit within the tactical
horizon. For each owned star, enumerate friendly sources that can arrive before
or at the combat tick. Then solve a small assignment problem:

- assign existing idle carriers to defensive tasks first
- require battle-margin safety, not merely one-ship survival
- avoid assigning the same ships to multiple mutually exclusive defenses
- prefer defenses that cover multiple possible enemy targets from a rally star
- only attack when projected remaining ships exceed the configured margin and
  the attack does not uncover a higher-value defense

The battle calculator should return:

- winner
- remaining ships
- minimum additional attackers
- minimum additional defenders
- margin after applying scheduled production and friendly arrivals
- sensitivity to one weapons level difference

The tactical planner should output a task ledger, not just commands.

## Carrier Budget Policy

The current bot spends too freely on carriers. New carriers are useful only when
they unlock a task whose expected value exceeds their cost and opportunity cost.

Rules:

- Existing idle carriers are allocated before new carriers are considered.
- Carrier builds are never counted as defense unless they can move existing
  ships in time and the resulting task value exceeds the carrier cost.
- Neutral expansion carrier builds are capped by a per-turn logistics budget.
- Staging carriers are lowest priority and require leftover cash after infra,
  defense, expansion, and tech-transfer reserves.
- A carrier build must name the task it enables, the source star, ship count,
  ETA, expected value, and why an existing carrier cannot do it.
- The planner should prefer one carrier carrying enough ships over multiple
  one-ship carriers unless the task is neutral capture and each destination
  only needs one ship.

Suggested first-pass budget:

```text
logisticsBudget = min(
  cashAfterMandatoryReserves * logisticsSpendRatio,
  cashAfterMandatoryReserves - minimumInfraBudget,
)
```

Default values:

- `logisticsSpendRatio`: 0.25 outside emergencies
- `minimumInfraBudget`: enough for the best-ranked economy purchase before
  production, otherwise enough for the best-ranked industry purchase
- emergency defense may exceed the cap only when the tactical search shows a
  carrier-enabled defense saves a star with value greater than the overspend

Carrier costs should be part of the same plan ledger as infrastructure, so the
bot can compare "buy carrier for neutral" against "buy economy now".

## Data Structures

Introduce these modules rather than continue growing `planner.ts`:

- `state.ts`: normalized scan indexes and immutable helper views
- `forecast.ts`: future cash, production, research, movement, and combat state
- `tasks.ts`: tactical task generation and value scoring
- `routing.ts`: graph construction, ETA, path search, and route legality
- `combat.ts`: battle calculator and combat search helpers
- `optimizer.ts`: infrastructure and budget optimizer
- `logistics.ts`: carrier allocation and carrier-build decisions
- `planner.ts`: orchestration only

Planner contracts should be plain data:

```ts
interface TacticalTask {
  kind: "defend" | "capture_neutral" | "attack" | "rally" | "stage";
  targetUid: number;
  deadlineTick: number;
  requiredShips: number;
  preferredShips: number;
  value: number;
  risk: "mandatory" | "high" | "medium" | "low";
}

interface LogisticsPlan {
  assignments: FleetAssignment[];
  carrierBuilds: CarrierBuild[];
  cashReserved: number;
  taskResults: TaskResult[];
}

interface InfraPlan {
  purchases: InfraPurchase[];
  cashSpent: number;
  utility: number;
  utilityBreakdown: Record<string, number>;
  rejected: RejectedCandidate[];
}
```

## Implementation Plan

1. Replace the default planning horizon with 30 ticks.
2. Add a bounded integer infrastructure optimizer inside the existing planner
   before splitting modules.
3. Add a logistics budget so new carrier builds compete with infrastructure
   instead of consuming all available cash.
4. Replace greedy one-fleet defense with a small defensive carrier-group
   search.
5. Split pure helpers out of `planner.ts` without changing behavior.
6. Add `forecast.ts` and make the current planner consume projected star ships
   and production timing from it.
7. Add task generation for defense, neutral expansion, attacks, and staging.
8. Replace carrier coverage with logistics allocation over task value and
   carrier budget.
9. Add one-hop routing search and make attack/defense assignments use routes
   rather than direct-only checks.
10. Extend dry-run output with candidate task, logistics, and optimizer ledgers.
11. Add replay fixtures from real dry runs before tuning weights.

## Validation

Minimum tests before trusting live submission:

- hand-solvable infrastructure fixture where economy before production beats
  industry
- fixture where industry near the frontier beats cheaper backline industry
- fixture where carrier cost makes a neutral capture not worth taking
- fixture where an existing carrier prevents a duplicate carrier build
- fixture where a rally point defends multiple possible enemy targets
- fixture where an attack is rejected because it uncovers a higher-value defense
- replay of the current active game tick that demonstrates fewer carrier builds
  and a clearer infrastructure plan than the MVP heuristic

## Tuning Discipline

Do not tune weights only from the active game. Each bad turn should become a
small replay fixture with the observed scan, expected high-level decision, and
the reason the old planner failed. Weight changes should improve the fixture
without breaking earlier ones.

The design target is not perfect play on the next turn. It is a planner that can
explain tradeoffs in a way that lets us improve it systematically.
