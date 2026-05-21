# sync

This directory contains a utility for synchronization with the original game client assets.

## Key Features
- **Sync Script**: A bash script (`sync`) that uses `curl` to download original client-side JavaScript files from `np.ironhelmet.com`.
- **Client Source Snapshot**: Downloaded JavaScript files under `np/` plus shared UI scripts at the directory root.

## Useful as Examples for:
- Identifying core game client files (e.g., `universe.js`, `map.js`, `game.js`).
- Automating the retrieval of external dependencies or assets.

## Files Worth Reading

- `sync`: enumerates the client files currently mirrored from `https://np4.ironhelmet.com/scripts/client/`.
- `np/universe.js`: the most important reference for interpreting scan data. It
  expands `galaxy`, `stars`, `fleets`, and `players`; computes ETA, scan range,
  propulsion range, wormhole links, and gate speed; and attaches convenience
  objects such as `fleet.orbiting`, `fleet.path`, and `player.homeStar`.
- `np/map.js`: map rendering and selection behavior.
- `np/game.js`, `np/interface.js`, `np/screens.js`: client-side event flow and
  interface behavior.

## Scan-Model Details Confirmed Here

- `playerUid` is the active perspective key, and the current player's object is
  selected from `galaxy.players[playerUid]`.
- `fleet.ouid` points to the currently orbited star. Fleets in transit have no
  orbiting star and rely on `fleet.path`, `fleet.orders`, and reported
  `fleet.speed` for ETA.
- `fleet.lsuid` links a fleet to its last star when that star is available in
  the scan.
- Wormholes use `star.wh`; if one endpoint is visible, the client infers the
  reverse link onto the paired star.
- `calcRangeValue(player)` is `0.5 + propulsionLevel * 0.125`.
- `calcScanValue(player)` is `0.375 + scanningLevel * 0.125`, except games with
  `config.noScn` use propulsion range as scan range.
- Gated travel uses `fleetSpeed * 3`, or `fleetSpeed * sqrt(propulsion + 3)` in
  games with `config.newRng === 1`.

Prefer this directory for client-accurate mechanics. Prefer `aib/src/types.ts`
for the local raw scan schema.
