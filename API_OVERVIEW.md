# Neptune's Pride API Overview

This document is a working guide to the NP4 scan response used by `aib`. The
scan is a complete-enough snapshot for one player, but it is not omniscient:
fields appear or disappear based on that player's scanning range, diplomacy,
and ownership.

The TypeScript representation lives in [src/types.ts](src/types.ts). The
checked-in [api.sample.json](api.sample.json) is useful for validating the
model against an actual scan payload.

## Authentication and Fetching

The scan endpoint requires a `GAME_ID` and an `API_KEY`, also called a `code`.

```text
https://np.ironhelmet.com/api?game_number=[GAME_ID]&api_version=0.1&code=[API_KEY]
```

The response root is an object with a single `scanning_data` property:

```ts
interface ApiResponse {
  scanning_data: ScanningData;
}
```

All large collections under `scanning_data` are maps keyed by stringified
numeric UIDs:

- `stars: Record<string, Star>`
- `fleets: Record<string, Fleet>`
- `players: Record<string, Player>`
- `victoryPoints: Record<string, number>`

Treat map keys as identifiers, not array indexes.

## Perspective System

The API response is filtered for `scanning_data.playerUid`. An AI player should
separate known facts from unknown facts before asking an LLM to evaluate a
position.

You can expect:

- full player-private fields for the player whose API key produced the scan
- full star infrastructure only for scanned stars
- all star names, positions, owners, and visibility state
- only fleets visible to the scanning player
- partial public summaries for other players

Do not infer missing infrastructure, cash, research progress, or fleet routes
from absent fields. Absence usually means "not visible from this perspective",
not zero.

## Time and Production

The current game time is represented by:

- `tick`: the current discrete game tick
- `tickFragment`: fraction of the current tick that has elapsed
- `now`: server-side millisecond timestamp for the scan
- `tickRate`: minutes per tick

Production timing is represented separately:

- `productionRate`: ticks between production cycles
- `productionCounter`: ticks remaining until the next production cycle
- `productions`: number of production cycles that have already occurred

An agent planning future states should use `tick` and `tickFragment` for fleet
movement, but `productionCounter` and `productionRate` for economic production.

## Stars

Stars are discriminated by `v`.

### Unscanned Stars

Unscanned stars have `v: "0"` in the current type model. They provide the shared
`BaseStar` fields:

- `uid`: star UID
- `n`: star name
- `x`, `y`: map coordinates
- `puid`: owning player UID
- `exp`: experience or defensive bonus field, depending on game settings

They do not expose economy, industry, science, resources, ships, gate state, or
shipyard progress.

### Scanned Stars

Scanned stars have `v: 1` and add:

- `e`, `i`, `s`: economy, industry, and science infrastructure
- `nr`: natural resources
- `r`: terraformed resources
- `st`: ships stationed at the star
- `yard`: fractional progress toward the next ship
- `ga`: stargate flag, `0` or `1`

The current sample also contains rare `wh` fields on wormhole stars. That field
is not yet represented in `src/types.ts`.

## Fleets

Fleets carry ships and orders. Important fields:

- `uid`: fleet UID
- `puid`: owning player UID
- `x`, `y`: current coordinates
- `lx`, `ly`: previous coordinates or last star coordinates
- `st`: ships in the fleet
- `speed`: current fleet speed
- `ouid`: star UID if orbiting, or `0` while in transit
- `o`: orders as `[delay, starUid, action, argument]`
- `l`: looping-orders flag

The observed scan sample includes `l` as both numeric flags and boolean
`false`, and includes `lsuid` on some fleets. The current generated type is
stricter than that sample.

## Players

Player objects combine public empire summaries with perspective-private data.
The fields that are generally present include:

- `uid`, `alias`, `avatar`, `race`, `color`, `shape`
- `home`
- `totalStars`, `totalFleets`, `totalStrength`
- `totalEconomy`, `totalIndustry`, `totalScience`
- `ready`, `missedTurns`, `conceded`, `ai`, `regard`
- `tech`

Fields such as `cash`, `war`, `countdown_to_war`, `ledger`, and
`starsAbandoned` are visible for the scanning player in the checked-in sample,
but not for every player. `researching` and `researchingNext` are also not
universal in observed data.

When formal alliances are enabled, the scanning player's `war` map uses `0` for
an established formal alliance, `1` for an alliance offered by the other player,
`2` for an alliance requested by the scanner, and `3` for war.

`conceded` uses:

- `0`: active
- `1`: quit or AI-replaced
- `2`: AFK
- `3`: knocked out

For AI players, `regard` influences cooperation. Existing notes indicate that
an AI trades technology when `regard >= 0` and the cash sent is at least
`5 * totalEconomy`.

## Technology

`tech` is keyed by technology kind. Known kinds are:

0. Banking
1. Research
2. Manufacturing
3. Propulsion
4. Scanning
5. Weapons
6. Terraforming

Every observed tech entry has `kind` and `level`. `research` and `cost` are
perspective-dependent in the sample; they are present where research progress is
visible and absent elsewhere.

## Type Model Caveats

`src/types.ts` documents the intended scan shape, but the real sample currently
shows a few places where raw API data is looser:

- some `Player` fields modeled as required are only present for the scanning
  player or otherwise visible players
- some `TechInfo` fields modeled as required are absent on many public tech
  entries
- fleet `l` may be `false` as well as `0` or `1`
- fleets may include `lsuid`
- wormhole stars may include `wh`

Until those types are reconciled, ingestion code should validate raw scan data
at the boundary and preserve unknown fields for later analysis rather than
silently dropping them.

## LLM Agent Guidance

When converting a scan into an LLM prompt or tool input:

- keep UIDs in the representation so choices can be mapped back to API actions
- label unscanned stars explicitly instead of filling in guessed values
- distinguish current ships from future production
- distinguish public player totals from private player fields
- include `tick`, `tickFragment`, `productionCounter`, and `productionRate`
  together when asking for time-sensitive plans
- keep raw compact field names available near any friendly summaries, because
  they are the stable API contract
