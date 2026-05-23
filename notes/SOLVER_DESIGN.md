# Damage/Tick Solver Design

This document describes a solver-centered replacement for the current
heuristic turn planner. The goal is to make one decision cycle answer a precise
question:

> Given the current scan and a planning horizon, where should ships and credits
> be allocated to maximize combat-relevant damage/tick at that horizon while
> satisfying defensive obligations?

The design uses the NPA "Generals Science" damage/tick metric as the core
military productivity objective, then extends it from an empire-wide report into
a spatial optimization problem over stars, carriers, infrastructure, and
arrival deadlines.

## Fit In The Overall Architecture

The existing planner should move toward this flow:

1. Normalize the scan and build graph indexes.
2. Forecast visible production, research, movement, and attacks over horizon
   `H`.
3. Build a tactical demand model: required defenses, contested hubs, expansion
   opportunities, and attack targets.
4. Run the solver over infrastructure, ship allocation, and carrier capacity.
5. Translate the solver's selected actions into command intents.
6. Validate command intents against the original scan and submit or dry-run.

This keeps the high-level architecture from `DESIGN_OVERVIEW.md`:

- The strategic layer chooses policy: horizon, risk, diplomacy posture, and
  desired aggression.
- The tactical graph layer enumerates legal movement edges and combat tasks.
- The solver layer allocates scarce resources exactly within that bounded
  tactical model.

The solver should not infer player motives or write diplomacy. Its job is to
make the mechanical part of the turn auditable: credits, ships, carriers,
defense reserves, and attack pressure.

## NPA Damage/Tick Metric

NPA's report computes a compact military productivity score:

```text
shipsPerTick = totalIndustry * (manufacturing + 4) / productionTicks
rounds = ceil(shipsPerTick / (bestEnemyWeapons + 1))
damagePerTick = floor(rounds * ownWeapons)
```

In NPA this is an empire-wide technology comparison. It asks how many effective
combat rounds the empire's production rate buys against the best relevant
enemy weapons level.

For the AI player, the same idea needs to become spatial:

```text
readyShipsPerTick[zone] =
  horizon-relevant ships that can affect zone
  / horizon bucket

rounds[zone] =
  ceil(readyShipsPerTick[zone] / (enemyWeapons[zone] + 1))

damagePerTick[zone] =
  rounds[zone] * ownWeapons
```

The solver then maximizes weighted damage/tick at the places where ships
matter, not merely total empire production.

## Planning Horizon

The default horizon should remain `H = 30` ticks.

The model also needs a smaller set of action ticks:

- `t = 0`: current scan tick, when commands are issued
- production ticks inside `H`
- fleet arrival ticks inside `H`
- combat deadlines inside `H`
- final horizon tick `H`

The first implementation can be a single-turn, single-horizon MILP. It does not
need to model future turns choosing new orders at later ticks. Each invocation
solves from the current scan and will re-solve next turn with better data.

## Current Implementation: Portfolio Infrastructure Solve

The current code implementation is a single-turn portfolio solve over
current-turn infrastructure purchases, not yet the full MILP described below.
It deliberately does not stop at the first locally-positive purchase. Instead,
it repeatedly evaluates complete terminal states under one objective:

- build defense, expansion, and frontier zones from the current scan;
- evaluate reachable industry and ships/tick for each zone at horizon `H`;
- project research completion from the resulting science total;
- score continuous damage/tick so small industry changes have marginal value;
- add terminal infrastructure value so idle cash has low value compared with
  productive assets;
- reduce industry and science terminal value as they approach an
  economy-relative balance target.

This makes "spend before production" an objective consequence rather than a
fallback: if cash has low terminal value and infrastructure has persistent
terminal value, the best terminal state converts cash into E/I/S. The
industry/science balance is also objective-driven rather than enforced as a
hard cap: their marginal terminal value decays as total industry approaches
roughly `economy / 2` and total science approaches roughly `economy / 4`.

Carrier routing, ship allocation, hard defense constraints, and multi-tick
infrastructure sequencing should migrate into the same solver once this
objective is validated against recorded games.

## Inputs

The solver input should be a normalized, compact model:

```ts
interface SolverInput {
  horizonTicks: number;
  playerUid: number;
  cash: number;
  productionRate: number;
  productionCounter: number;
  turnJumpTicks: number;
  fleetCost: number;
  fleetCostIncrement: number;
  tech: {
    weapons: number;
    manufacturing: number;
    banking: number;
    researching: number;
    researchProgress: number;
    researchCost: number;
  };
  stars: SolverStar[];
  fleets: SolverFleet[];
  edges: SolverEdge[];
  zones: SolverZone[];
  tasks: SolverTask[];
  policy: SolverPolicy;
}
```

### Stars

Each owned scanned star contributes:

- current ships
- economy, industry, science
- natural resources/resource rating
- gate state
- infrastructure costs for the next several E/I/S levels
- whether it is interior, covered, hub, exposed, or enemy-facing
- legal movement edges to other modeled stars

Science is not local in the same way industry is. A new science level produces
research points globally, and a completed Weapons level changes combat
everywhere immediately. The solver must preserve that distinction.

Enemy and neutral stars appear as targets, not infrastructure sources.

### Fleets

Only friendly fleets that can receive orders are decision resources. In-flight
fleets with locked orders are forecasted as exogenous arrivals unless they are
idle at a star by the current tick.

Each usable fleet contributes:

- current ships
- current location
- legal destinations
- ETA to each destination
- whether it is already reserved by a non-negotiable task

### Zones

A zone is a place where combat productivity matters. Initial zone choices:

- each defense hub
- each threatened owned star not covered by a hub
- each valuable neutral expansion target
- each visible enemy star that can be attacked profitably

Zones carry weights. Defensive zones should usually outrank expansion and
attack zones.

### Tasks

Tasks are hard or soft tactical constraints:

- defend star `S` by tick `T` with at least `N` ships
- maintain reserve at hub `H` by tick `T`
- capture neutral `S` by tick `T` with at least `N` ships
- attack enemy `S` by tick `T` with at least `N` ships
- stage surplus from interior star `A` to hub/frontier `B`

Hard tasks must be satisfied if feasible. Soft tasks contribute objective value
or penalty.

## Decision Variables

The exact solver should be a mixed-integer linear program.

### Infrastructure

For each owned star `s`, infrastructure kind `k`, and purchasable level `l`:

```text
buyInfra[s,k,l] in {0,1}
```

Sequential constraints enforce that level `l+1` cannot be bought unless level
`l` is also bought.

```text
buyInfra[s,k,l+1] <= buyInfra[s,k,l]
```

### Carrier Builds

For each owned star `s` and possible carrier build slot `b`:

```text
buildCarrier[s,b] in {0,1}
carrierLoad[s,b] >= 0 integer
carrierToZone[s,b,z] in {0,1}
```

First implementation can cap new carriers per turn with a small constant, such
as 0-4, to keep the model small.

### Existing Fleet Routing

For each usable fleet `f` and destination zone/star `z`:

```text
routeFleet[f,z] in {0,1}
fleetLoad[f] >= 0 integer
```

Each fleet can take at most one route in the current turn:

```text
sum_z routeFleet[f,z] <= 1
```

### Ship Allocation

Ships are allocated from source stars to local garrison, existing fleets, new
carriers, or horizon inventory:

```text
garrison[s] >= 0 integer
shipToExistingFleet[s,f] >= 0 integer
shipToNewCarrier[s,b] >= 0 integer
shipHeld[s] >= 0 integer
```

Conservation:

```text
garrison[s]
+ shipHeld[s]
+ sum_f shipToExistingFleet[s,f]
+ sum_b shipToNewCarrier[s,b]
<= currentShips[s] + producedShips[s,H]
```

In the first pass, ship loading should only be allowed from a fleet's current
star or from a newly built carrier's source star. Multi-hop loading can come
later.

### Zone Readiness

For each zone `z`:

```text
readyShips[z] >= 0 integer
readyShipsPerTickBucket[z] >= 0 continuous
rounds[z] >= 0 integer
```

`readyShips[z]` is the sum of ships that can arrive at `z` by its deadline or by
the horizon.

## Constraints

### Cash

All immediate spending must fit current cash plus cash that arrives before the
spend is assumed to happen. The first version should treat all commands as
immediate spending, which is conservative and matches how the current turn
actually submits orders.

```text
sum infraCost[s,k,l] * buyInfra[s,k,l]
+ sum carrierCost[b] * buildCarrier[s,b]
+ reservedDiplomacyCash
+ policyCashReserve
<= currentCash
```

Later versions can include production income at future ticks and allow planned
future purchases, but the command system only submits current-turn orders, so
immediate cash is enough for the first solver.

### Infrastructure Production

Economy affects future cash only if a production boundary occurs inside the
horizon.

Industry affects ships according to NP4 production:

```text
shipsPerTick[s] =
  industry[s] * (manufacturing + 4) / productionRate
```

The linear model can approximate final produced ships by:

```text
producedShips[s,H] =
  baseProducedShips[s,H]
+ shipGainPerIndustry[s,H] * sum_l buyInfra[s,industry,l]
```

This is linear because each industry level bought contributes the same marginal
ships over a fixed horizon once timing is fixed. If exact timing matters, split
the horizon into production intervals.

### Research And Science

Science must be modeled as a first-class combat investment. It is not merely a
future-growth tiebreaker.

The main reason is Weapons. Industry creates ships at specific stars, and those
ships only matter where they can arrive before the relevant deadline. Weapons is
global: when Weapons completes, every existing ship, every produced ship, every
defense, and every attack immediately fights better everywhere on the map. In
early NP4, the jump from W1 to W2 is often decisive, and W2 to W3 remains very
large.

The solver should therefore include research timing explicitly.

For each possible science purchase:

```text
buyInfra[s,science,l] in {0,1}
```

Total science at tick 0:

```text
scienceTotal =
  currentScience + sum_s,l buyInfra[s,science,l]
```

For each candidate research target `r`, estimate completion:

```text
researchTicks[r] =
  ceil((researchCost[r] - researchProgress[r]) / scienceTotal)
```

The `ceil` can be represented with binary completion buckets:

```text
techComplete[r,t] in {0,1}
```

Where `techComplete[r,t] = 1` means target `r` completes no later than bucket
tick `t`. The model only needs buckets at meaningful ticks:

- current turn jump
- combat deadlines
- production ticks
- horizon

For each bucket `t`:

```text
scienceTotal * t >= remainingResearch[r] * techComplete[r,t]
```

Only one current research target can complete in the first pass. Later, the
model can chain `researchingNext` and multiple completions.

Weapons completion changes combat globally. In a scenario solve,
`ownWeaponsAt[z]` is a constant determined before the MILP is built:

```text
ownWeaponsAt[z] =
  currentWeapons + sum_t techComplete[weapons,t] * availableByDeadline[z,t]
```

Where `availableByDeadline[z,t]` is a constant: 1 if tech completion bucket `t`
is no later than the zone's combat or horizon deadline.

Manufacturing completion is different. It increases future ship production, but
only at stars with industry, and those additional ships still need geographic
access to the relevant zone. Its value must flow through produced ships and
movement constraints, not through a global combat multiplier.

This distinction is central:

- Weapons multiplies combat effectiveness of all ships already in position.
- Manufacturing increases later ship supply at industry locations.
- Industry increases later ship supply at one star.
- Science can accelerate either Weapons or Manufacturing, but its value depends
  on which completion it enables before important deadlines.

The first implementation should solve at least these research scenarios:

- no tech completion
- current research target completes by each meaningful bucket tick
- force next research target to Weapons and complete by each meaningful bucket
  tick, if switching research is legal and desired by policy
- force next research target to Manufacturing and complete by each meaningful
  bucket tick, mainly for comparison

Then compare objective values. This makes science compete directly with
industry and economy. If one science purchase moves Weapons completion before a
frontier battle, the objective should see the global damage swing and choose it.

### Weapons-Aware Battle Requirements

The battle calculator should precompute required ships under each relevant
Weapons scenario:

```text
requiredDefenseShips[task, weaponsScenario]
requiredAttackShips[task, weaponsScenario]
```

For W1 -> W2, these requirements can change dramatically. The MILP should
select a scenario through the research variables, then bind task constraints to
the matching required ship count.

For the first pass this can be done by solving separate scenario MILPs:

1. assume no Weapons completion before the deadline
2. assume Weapons completes by bucket `t`
3. compare objective after subtracting the science purchases required to make
   that scenario feasible

The second pass can keep the scenario choice inside one MILP, but it must avoid
bilinear terms. Use binary scenario variables and precomputed constants:

```text
researchScenario[q] in {0,1}
sum_q researchScenario[q] = 1
ownWeaponsAtScenario[z,q] = precomputed constant
```

Then bind battle requirements and damage buckets to the selected scenario with
indicator constraints or big-M constraints.

Weapons should also affect the objective directly. In the first implementation,
this is simple because each scenario MILP has fixed `ownWeaponsAt[z]`:

```text
damagePerTick[z] = rounds[z] * ownWeaponsAt[z]
```

In a later single-MILP implementation, replace that multiplication with
scenario-specific damage bucket variables:

```text
damageBucket[z,r,q] in {0,1}
damageBucket[z,r,q] <= roundBucket[z,r]
damageBucket[z,r,q] <= researchScenario[q]
damagePerTick[z] =
  sum_r,q r * ownWeaponsAtScenario[z,q] * damageBucket[z,r,q]
```

That is the part that lets the model value science correctly. A local industry
purchase might add ships that cannot reach the fight. A science purchase that
accelerates Weapons improves every zone at once.

### Movement Legality

Movement variables are allowed only on precomputed legal edges:

```text
routeFleet[f,z] = 0 if ETA(f,z) > deadline[z]
carrierToZone[s,b,z] = 0 if ETA(s,z) > deadline[z]
```

The graph layer computes range, speed, gates, and wormholes. The solver should
not recompute geometry.

### Defense Before Offense

Defensive hard constraints reserve ships before attack value is counted.

For each hard defense task:

```text
readyShips[defenseZone] + garrison[targetStar] >= requiredShips
```

For hub reserves:

```text
garrison[hub] + inboundShipsToHubByDeadline >= hubReserveRequirement
```

If a hard defense is infeasible, the model should expose infeasibility and rerun
with explicit slack variables:

```text
defenseShortfall[task] >= requiredShips - availableShips
```

Then the objective applies a very large penalty to shortfall, producing the
least-bad plan rather than failing to issue a turn.

### Expansion And Attack

Neutral capture:

```text
readyShips[neutralZone] >= captureShips * captureChosen[neutralZone]
```

Enemy attack:

```text
readyShips[enemyZone] >= requiredAttackShips[enemyZone] * attackChosen[enemyZone]
```

The battle calculator should precompute `requiredAttackShips` and
`requiredDefenseShips` for candidate fights using current weapons assumptions.
For a science-aware solve, it should precompute those requirements for each
Weapons scenario. That keeps combat nonlinearity out of the MILP while still
allowing science purchases to change tactical feasibility.

## Objective

The core objective is weighted damage/tick at the horizon. In the first
scenario-based implementation, `ownWeaponsAt[z]` is fixed for the solve:

```text
maximize
  sum_z zoneWeight[z] * ownWeaponsAt[z] * rounds[z]
- sum_task shortfallPenalty[task] * defenseShortfall[task]
- cashPenalty * spentCash
+ retainedCashValue * finalCash
+ researchProgressValue
+ techCompletionValue
+ captureValue
```

`techCompletionValue` should normally be zero for Weapons if the
damage/tick term is already active. Otherwise Weapons would be double counted.
It may be nonzero for non-combat techs when the strategic layer explicitly
wants them.

Science purchases are therefore valued through two mechanisms:

- direct feasibility: earlier Weapons reduces required ships for defenses and
  attacks;
- direct objective gain: earlier Weapons increases damage/tick in every zone
  whose deadline occurs after completion.

This should make early Weapons science naturally beat local industry whenever
the global combat multiplier matters more than a few geographically constrained
ships.

The NPA step function is:

```text
rounds[z] = ceil(readyShipsPerTick[z] / (enemyWeapons[z] + 1))
```

MILP solvers do not directly optimize `ceil`, so use a bounded integer
linearization:

```text
rounds[z] >= readyShipsPerTick[z] / (enemyWeapons[z] + 1)
rounds[z] <= maxRounds[z]
```

Since the objective maximizes `rounds[z]`, this lower-bound-only form would let
rounds grow without real ships. Add an upper link:

```text
readyShipsPerTick[z] >=
  (rounds[z] - 1) * (enemyWeapons[z] + 1) + epsilon
```

For an initial implementation, an easier and safer formulation is binary bucket
selection:

```text
roundBucket[z,r] in {0,1}
sum_r roundBucket[z,r] <= 1
readyShipsPerTick[z] >= threshold[z,r] * roundBucket[z,r]
rounds[z] = sum_r r * roundBucket[z,r]
```

Where:

```text
threshold[z,r] = (r - 1) * (enemyWeapons[z] + 1) + 1
```

This makes the NPA step function explicit and debuggable.

## What Counts As Ready Ships Per Tick

NPA's original metric uses empire-wide `shipsPerTick`. The AI needs a local
version.

For a zone `z`, define:

```text
readyShipsPerTick[z] =
  readyShips[z] / horizonBucket[z]
```

`horizonBucket[z]` should be:

- `H` for long-horizon frontier pressure
- time until combat for a hard defense
- time until arrival for a planned attack
- production cycle length for strategic production comparison

This is intentionally a policy choice. The planner should print the bucket used
for each zone so damage/tick does not become an opaque number.

## Solver Output

The solver returns a decision trace, not raw game commands:

```ts
interface SolverResult {
  status: "optimal" | "feasible" | "infeasible";
  objectiveValue: number;
  damagePerTickByZone: ZoneDamageReport[];
  infrastructureBuys: InfraIntent[];
  carrierBuilds: CarrierBuildIntent[];
  fleetRoutes: FleetRouteIntent[];
  shipAllocations: ShipAllocationReport[];
  defenseShortfalls: DefenseShortfallReport[];
  cash: {
    start: number;
    spentInfra: number;
    spentCarriers: number;
    reserved: number;
    remaining: number;
  };
  rejected: SolverRejectedAlternative[];
}
```

The command layer then converts intents into existing command payloads:

- `upgrade_economy`
- `upgrade_industry`
- `upgrade_science`
- `new_fleet`
- `add_fleet_orders`

The command layer remains responsible for validating affordability, current
ownership, ship counts, and stale scan assumptions.

## Solver Dependency

The implementation should use an actual solver rather than hand-rolled search
once this design is implemented.

Reasonable options:

- HiGHS via a CLI or WASM binding
- GLPK via `glpk.js`
- OR-Tools through a small sidecar process

For this TypeScript codebase, the lowest-friction first pass is likely:

1. Emit an LP/MPS model file from TypeScript.
2. Invoke `highs` locally when installed.
3. Parse the solution file back into `SolverResult`.
4. In cloud deployment, package a known solver binary or switch to a WASM
   binding.

This keeps the model auditable. A failed solve can attach the LP file to the
decision trace.

## Implementation Plan

### Phase 1: Model Builder Only

- Build `src/solver/model.ts`.
- Convert scan and tactical graph into `SolverInput`.
- Emit a human-readable model summary with variables, constraints, and zone
  weights.
- Do not submit solver decisions yet.

### Phase 2: Infrastructure MILP

- Optimize E/I/S purchases for horizon damage/tick, including science purchases
  that can accelerate the current research target.
- Keep tactical movement fixed.
- Compare solver infrastructure buys against the current bounded optimizer in
  dry-run output.

### Phase 2.5: Weapons Scenario Solves

- Generate meaningful completion buckets for Weapons.
- Solve no-completion and Weapons-completion scenarios.
- Show how each science purchase changes completion tick, required defenders,
  required attackers, and damage/tick.
- Make science compete directly against industry in early-game turns.

### Phase 3: Defensive Logistics MILP

- Add carrier builds and existing idle carrier routing.
- Require hard defense reserves before expansion.
- Replace interior-to-hub supply heuristics.

### Phase 4: Full Tactical Allocation

- Add attack and expansion zones.
- Allocate ships among defense, expansion, and attack in one solve.
- Replace neutral expansion, staging, and simple attack heuristics.

### Phase 5: Scenario Solves

- Run scenario variants for likely weapons/manufacturing completions and
  research-target switches.
- Run enemy weapons +1 stress tests.
- Pick the plan with best risk-adjusted score.

## Debug Output

Every dry run should include:

- objective value
- damage/tick by zone
- current research target, science total, and projected completion tick
- science purchases considered and which combat deadlines they move
- damage/tick delta for Weapons completion scenarios
- defense constraints and slack
- chosen infrastructure buys with marginal objective contribution
- chosen carrier builds and route purpose
- ship flow from source stars to zones
- cash use
- top rejected alternatives

Map visualization should draw:

- zone weights
- selected hubs
- ship source stars
- solver-selected flows
- shortfall zones in red

## Open Questions

- Should `readyShipsPerTick` use the full horizon, a production cycle, or the
  exact task deadline for each zone?
- How much value should retained cash have relative to damage/tick?
- Should non-Weapons science have a direct strategic value term, or should all
  science value flow through forecasted tech completions?
- Should attack zones include only visible enemy stars, or inferred enemy
  interior stars from scan history?
- How conservative should the default enemy weapons assumption be?

The first useful version should answer these with explicit config defaults and
print them in the decision trace.
