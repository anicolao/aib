# Neptune's Pride API Overview

This document provides a high-level guide to using the Neptune's Pride API. The API provides a comprehensive snapshot of the game state from the perspective of a specific player.

## Authentication and Fetching

To access the API, you need a `GAME_ID` and an `API_KEY` (also referred to as a `code`). The endpoint is:
`https://np.ironhelmet.com/api?game_number=[GAME_ID]&api_version=0.1&code=[API_KEY]`

The response is a JSON object where the root is `scanning_data`.

## Core Concepts

### 1. The Perspective System
The API response is filtered based on the `playerUid` provided in the authentication. You will only see:
- Full details for your own stars and fleets.
- Infrastructure and ship counts for stars/fleets within your scanning range (`v: 1`).
- Basic location and ownership for stars outside your range (`v: "0"`).
- Fleets in transit that are within your scanning range.

### 2. Time and Ticks
- `tick`: The current discrete time unit of the game.
- `tickFragment`: A value between 0 and 1 indicating how much of the current tick has elapsed.
- `now`: Server-side millisecond timestamp.
- `tickRate`: The interval (in minutes) between production-relevant cycles (typically 60).

### 3. Stars (`stars`)
Stars are the primary nodes in the galaxy.
- **Visible Stars (`v: 1`)**: Provide data on economy (`e`), industry (`i`), science (`s`), and current ship strength (`st`).
- **Infrastructure**: Natural resources (`nr`) and terraformed resources (`r`) determine the cost and efficiency of upgrades.
- **Production**: `yard` indicates fractional progress toward the next ship being built.

### 4. Fleets (`fleets`)
Fleets carry ships between stars.
- `st`: Total ships in the fleet.
- `o`: An array of orders. Each order is a 4-element tuple: `[delay, starUid, action, argument]`.
- `ouid`: The UID of the star the fleet is currently orbiting. If `0`, the fleet is in transit.

### 5. Diplomacy and AI (`players`)
- **Regard**: For AI players, `regard` determines cooperation. The AI always trades technology if `regard >= 0` and it is sent sufficient cash (at least `5 * totalEconomy`).
- **Conceded**: Indicates player status: `0` (Active), `1` (Quit/AI-replaced), `2` (AFK), `3` (KO).

### 6. Technology (`tech`)
Tech is indexed by kind:
0. **Banking**: Increases starting cash after production.
1. **Research**: Increases research point generation.
2. **Manufacturing**: Increases ship production per industry point.
3. **Propulsion**: Increases fleet speed.
4. **Scanning**: Increases scanning range.
5. **Weapons**: Increases combat effectiveness.
6. **Terraforming**: Increases the effective resources of stars.
