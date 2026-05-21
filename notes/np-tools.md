# np-tools

This directory contains small Bun/TypeScript helpers for Neptune's Pride and Iron Helmet games.

## Key Features
- **Message and Event Export**: Tools to log into `np.ironhelmet.com` and download diplomacy messages and event feeds.
- **Data Formats**: Exports data into `.jsonl` files (messages and events).

## Useful as Examples for:
- Authenticating with Iron Helmet systems.
- Handling paginated API responses.
- Structuring simple CLI tools in Bun/TypeScript.

## Files Worth Reading

- `src/index.ts`: logs in through `/account_api/login`, initializes the account
  through `/account_api/init_player`, then pages through
  `/game_api/fetch_game_messages` for `game_diplomacy` and `game_event`.
- `src/index.test.ts`: compact Bun tests that mock `fetch` and verify login,
  pagination, comments, normalization, and output file naming.
- `README.md`: environment variables and invocation examples.

## Output Shape

The exporter writes two JSONL files in `NP_OUTPUT_DIR`:

- `<user>.<gameid>.messages.jsonl`
- `<user>.<gameid>.events.jsonl`

Diplomacy messages include a `comments` field populated from
`fetch_game_message_comments`. The exporter normalizes useful payload fields
onto top-level `body` and `player_uid` properties where possible.

## Relationship to `aib`

This is not a scan-data client. It is useful for adding diplomatic and event
history context to a player model, especially if an LLM needs to understand
recent messages, war declarations, quit events, or other event-feed state that
is not fully represented in a single scan.
