# Discord Webhook Reporting

The local CLI can post the same Markdown turn summary it prints in the terminal
to a private Discord channel. This is intended for monitoring local or
turn-loop runs without opening the terminal history.

Discord incoming webhooks post to the channel where the webhook was created.
The Discord developer docs describe executing a webhook by POSTing a JSON
payload to the webhook URL, and the `content` field is limited to 2000
characters:

- https://docs.discord.com/developers/resources/webhook#execute-webhook
- https://docs.discord.com/developers/platform/webhooks

## Private Channel Setup

1. In Discord, create a private text channel in the server that should receive
   AIB turn summaries.
2. Restrict the channel to only the owner or a small role that should see game
   state.
3. Open the channel settings and create an incoming webhook from the
   Integrations/Webhooks screen.
4. Give the webhook a clear name, such as `aib-turn-summary`.
5. Copy the webhook URL.
6. Put the URL in local configuration, not in committed files:

```text
AIB_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

The webhook can only post into the channel it belongs to. To change the target
channel, edit or recreate the webhook in Discord.

## CLI Configuration

The CLI posts to Discord only when configured.

Environment variables:

- `AIB_DISCORD_WEBHOOK_URL`: webhook URL to post to.
- `AIB_DISCORD_WEBHOOK=0`: disable Discord posting even if a URL exists.
- `AIB_DISCORD_USERNAME`: optional displayed webhook username.

CLI flags:

- `--discord-webhook URL`: post this run to the given webhook URL.
- `--no-discord`: suppress webhook posting for this run.

The `--discord-webhook` flag overrides `AIB_DISCORD_WEBHOOK_URL`. `--no-discord`
and `AIB_DISCORD_WEBHOOK=0` are useful when re-running a dry run that should not
notify the channel.

When `AIB_DISCORD_USERNAME` is set, AIB also repeats that name in the Discord
Markdown title, for example `# AIB Turn Summary - Calculum`. This keeps reports
distinguishable even when Discord visually groups webhook posts under an earlier
display name.

## Message Shape

The CLI reuses the existing Markdown summary generated for terminal output. It
does not send the raw JSON result. When debug map generation is enabled, the CLI
also uploads each generated PNG to the same webhook after the text summary.

Because Discord message content is limited to 2000 characters, the poster:

1. splits the full Markdown summary into top-level and section-level chunks;
2. sends each section as a separate Discord message when possible;
3. further splits oversized sections on line boundaries;
4. falls back to hard splitting only for unusually long single lines.

The payload disables allowed mentions so star or player names cannot accidentally
trigger Discord role/user notifications.

Discord may rate limit webhooks when a large summary becomes many messages. AIB
treats HTTP 429 responses as retryable, waits for Discord's `retry_after`
duration, and then continues sending the remaining chunks.

Debug map uploads use Discord's multipart webhook format, with the PNG attached
as `files[0]` and a short text label naming the local map path.

## Failure Mode

Webhook delivery is a reporting side effect. If posting fails, the CLI should
fail the run after printing/submitting the turn result, because a missing report
is operationally important. The game orders have already been produced by that
point, so rerunning with `--no-discord` may be appropriate if the Discord outage
should not block later local automation.
