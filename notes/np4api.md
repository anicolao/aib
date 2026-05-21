# np4api

This directory contains samples and a core utility for interacting with the Neptune's Pride official API.

## Key Features
- **API Client**: A simple `get` function that handles fetch requests to the API endpoint.
- **Sample Scripts**: Examples of how to fetch game state using a `GAME_ID` and an `API_KEY`.

## Useful as Examples for:
- Direct interaction with the game's official API.
- TypeScript interfaces for game data (see `api_sample.ts`).
- Basic fetch and parameter encoding patterns.

## Files Worth Reading

- `index.ts`: fetches from `https://np4.ironhelmet.com/api` and appends an
  extra `osric_laptop` query marker before the encoded API parameters.
- `api_sample.ts`: fetches from `https://np.ironhelmet.com/api` and appends an
  `api_example` query marker.
- `sample.ts`: older App Engine endpoint example using
  `https://neptunespride4.appspot.com/api`.

## Caveats

These scripts are intentionally minimal:

- they log `GAME_ID` and `API_KEY` to stdout, so do not use them unchanged for
  routine automation
- they parse whatever JSON comes back and do not validate `scanning_data`
- the endpoint variants are historical references; prefer the endpoint that
  matches the running NP4 client or the one documented in `aib/API_OVERVIEW.md`
- the `get` helper is useful for request shape, but `aib` should wrap fetch with
  explicit error handling and type validation at the boundary
