# Project Notes

This TypeScript workspace is for building an LLM-backed Neptune's Pride player.
The first responsibility of the codebase is to model NP4 scan data clearly
enough that an agent can reason about the current game state, uncertain
information, and legal tactical choices without guessing at raw API fields.

## Useful Files

- [../API_OVERVIEW.md](../API_OVERVIEW.md): human-oriented notes on the NP4 scan
  API and the conventions the agent should observe.
- [../src/types.ts](../src/types.ts): TypeScript interfaces for the scan
  response.
- [../api.sample.json](../api.sample.json): a real scan payload for checking the
  type model and examples.
- [../docs/index.html](../docs/index.html): generated TypeDoc output for the
  exported types.

## Reference Directories

The sibling directories are useful as source material, but they serve different
purposes:

- [../../sync](../../sync): synced NP4 client assets. Use this for formulas and
  client interpretation of raw scan fields.
- [../../np4api](../../np4api): minimal scan-fetch examples. Use this for the
  shape of API requests, not as a production client.
- [../../npa](../../npa): mature browser-extension implementation with scan
  merging, time travel, combat projection, visibility, and reports.
- [../../np-tools](../../np-tools): standalone Bun exporter for authenticated
  diplomacy messages and event feeds.

## Development Notes

Install dependencies with `npm install`. The repository currently contains type
definitions and generated documentation, but no runtime player loop yet.

When extending the agent, keep raw scan parsing separate from strategic
interpretation. The raw API uses compact field names such as `puid`, `st`, `nr`,
and `yard`; higher-level code should translate those into concepts like owner,
ships, resources, and production only after preserving the original facts.

Keep the root [../README.md](../README.md) intentionally sparse. Put internal
orientation material in `notes/` instead.
