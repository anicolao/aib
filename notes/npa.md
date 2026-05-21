# npa (Neptune's Pride Agent)

This is the largest repository in the workspace, containing the source code for the "Neptune's Pride Agent" browser extension.

## Key Features
- **Browser Extension**: Full implementation of a Chrome/Firefox extension.
- **Game Logic**: Modules for alliances, combat calculation, intel gathering, and scanning.
- **UI/UX**: Extensive UI code for enhancing the game experience.
- **Testing**: Comprehensive test suites using Playwright (E2E) and Vitest (unit).

## Useful as Examples for:
- Complex game state management and patching.
- Advanced TypeScript patterns in a large project.
- Robust E2E and unit testing strategies for a game interface.
- Handling real-time game events and DOM manipulation.

## Files Worth Reading

- `src/galaxy.ts`: NPA's scan-related types and helpers. It supports both older
  snake_case scan fields and NP4 camelCase fields, has `FleetOrder`, `getTech`,
  `getScanValue`, `getRangeValue`, `isVisible`, and `addAccessors`.
- `src/intel.ts`: the main integration layer. It fetches scan data with
  `api_version: "0.1"`, caches fresh scans, merges scans from multiple API keys,
  builds reports, and wires hotkeys to UI behavior.
- `src/timetravel.ts`: projects future ticks. Useful for production, fleet
  movement, research progress, cash production, and route-speed logic.
- `src/combatcalc.ts`: computes combat outcomes and alliance-sensitive fleet
  ownership behavior.
- `src/visibility.ts`: builds a BSP tree over stars and answers "within scan
  range" queries.
- `src/patch.ts` and `src/timemachine.ts`: diff, patch, cache, and replay scan
  histories.
- `tests/scandata.ts`: large realistic test scan data.

## Details Relevant to `aib`

- NPA treats star visibility as `v === "1" || v === 1`, and unscanned as either
  string or numeric zero. `aib/src/types.ts` currently models unscanned stars as
  `v: "0"` only.
- NPA's `TechInfo` allows `research` and `cost` to be optional. That matches the
  observed public player tech entries in `aib/api.sample.json` better than the
  current strict `aib` type.
- NPA's player model allows private fields such as `war`, `researching`, and
  `cash` to be optional. The sample scan also shows those fields are not present
  for every player.
- `mergeScanData` is a strong reference for combining allied scans: it prefers
  richer tech data, adjusts coordinate offsets between perspectives, replaces
  visible stars with scanned details, and only fully overwrites fleets owned by
  the scanned player.
- `futureTime` is useful as a first implementation reference, but it is coupled
  to the live extension global `NeptunesPride`. Port formulas, not the module
  structure.
